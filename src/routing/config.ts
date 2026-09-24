import { loadRoutingFileConfig } from "../config.js";
import { isLifeScienceRoutingEnabled } from "../domain/life-science/routing/config.js";
import {
  isNvidiaIntegrateApi,
  readLlmProviderProfileId,
  resolveLlmProviderProfile,
  type LlmProviderProfile,
} from "../llm/llmProviderProfile.js";

export { isLifeScienceRoutingEnabled, isNvidiaIntegrateApi };

export type RoutingLlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Max papers per LLM request (also capped by maxInputTokens). */
  maxPapersPerBatch: number;
  /** Estimated input token budget per request (title-only payloads). */
  maxInputTokens: number;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  /** OpenAI json_object mode; nvidia profile leaves this off. */
  preferJsonResponseFormat: boolean;
  /** True only for the nvidia profile when enableThinking is false. */
  disableThinking: boolean;
  /**
   * Resolved provider profile. Production getters always set this.
   * Omitted only by hand-built test configs; transport then infers from baseUrl.
   */
  providerProfile?: LlmProviderProfile;
};

export function getRoutingLlmConfig(): RoutingLlmConfig {
  const file = loadRoutingFileConfig();

  const apiKey =
    process.env.ROUTING_LLM_API_KEY?.trim() ||
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) {
    throw new Error(
      "Life-science routing is enabled but no API key found. Set ROUTING_LLM_API_KEY, NVIDIA_API_KEY, or OPENAI_API_KEY.",
    );
  }

  const model = process.env.ROUTING_LLM_MODEL?.trim();
  if (!model) {
    throw new Error(
      "ROUTING_LLM_MODEL is not set. Add it to .env locally or as a repository secret (not committed).",
    );
  }

  const baseUrl = file.baseUrl.replace(/\/$/, "");
  const providerProfile = resolveLlmProviderProfile({
    baseUrl,
    profileId: readLlmProviderProfileId("ROUTING_LLM_PROFILE"),
    enableThinking: file.enableThinking,
  });

  return {
    apiKey,
    baseUrl,
    model,
    maxPapersPerBatch: file.maxPapersPerBatch,
    maxInputTokens: file.maxInputTokens,
    timeoutMs: file.timeoutMs,
    maxTokens: file.maxTokens,
    maxRetries: file.maxRetries,
    preferJsonResponseFormat: providerProfile.preferJsonResponseFormat,
    disableThinking: providerProfile.disableThinking,
    providerProfile,
  };
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "***";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}
