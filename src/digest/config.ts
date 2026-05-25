import { loadDigestFileConfig } from "../config.js";
import { isNvidiaIntegrateApi, maskApiKey } from "../routing/config.js";

export { maskApiKey };

export function isDigestLlmEnabled(): boolean {
  const flag = process.env.ENABLE_LLM_DIGEST?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export type DigestLlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxFeatured: number;
  overflowShowTitleZh: boolean;
  maxPapersPerBatch: number;
  maxInputTokens: number;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  summarizeConcurrency: number;
  preferJsonResponseFormat: boolean;
  disableThinking: boolean;
};

export function getDigestLlmConfig(): DigestLlmConfig {
  const file = loadDigestFileConfig();

  const apiKey =
    process.env.DIGEST_LLM_API_KEY?.trim() ||
    process.env.ROUTING_LLM_API_KEY?.trim() ||
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) {
    throw new Error(
      "Digest LLM is enabled but no API key found. Set DIGEST_LLM_API_KEY, ROUTING_LLM_API_KEY, NVIDIA_API_KEY, or OPENAI_API_KEY.",
    );
  }

  const model = process.env.DIGEST_LLM_MODEL?.trim();
  if (!model) {
    throw new Error(
      "DIGEST_LLM_MODEL is not set. Add it to .env locally or as a repository secret (not committed).",
    );
  }

  const baseUrl = file.baseUrl.replace(/\/$/, "");
  const nvidia = isNvidiaIntegrateApi(baseUrl);

  return {
    apiKey,
    baseUrl,
    model,
    maxFeatured: file.maxFeatured,
    overflowShowTitleZh: file.overflowShowTitleZh,
    maxPapersPerBatch: file.maxPapersPerBatch,
    maxInputTokens: file.maxInputTokens,
    timeoutMs: file.timeoutMs,
    maxTokens: file.maxTokens,
    maxRetries: file.maxRetries,
    summarizeConcurrency: file.summarizeConcurrency,
    preferJsonResponseFormat: !nvidia,
    disableThinking: nvidia && !file.enableThinking,
  };
}
