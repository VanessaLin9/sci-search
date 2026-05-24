import { loadRoutingFileConfig } from "../config.js";

export function isLifeScienceRoutingEnabled(): boolean {
  const flag = process.env.ROUTE_LIFE_SCIENCE?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function isNvidiaIntegrateApi(baseUrl: string): boolean {
  return baseUrl.includes("integrate.api.nvidia.com");
}

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
  /** OpenAI json_object mode; skipped on NVIDIA if unsupported. */
  preferJsonResponseFormat: boolean;
  /** GLM / NVIDIA: disable chain-of-thought for cheap routing. */
  disableThinking: boolean;
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
  const nvidia = isNvidiaIntegrateApi(baseUrl);

  return {
    apiKey,
    baseUrl,
    model,
    maxPapersPerBatch: file.maxPapersPerBatch,
    maxInputTokens: file.maxInputTokens,
    timeoutMs: file.timeoutMs,
    maxTokens: file.maxTokens,
    maxRetries: file.maxRetries,
    preferJsonResponseFormat: !nvidia,
    disableThinking: nvidia && !file.enableThinking,
  };
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "***";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}
