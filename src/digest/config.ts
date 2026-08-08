import { loadDigestFileConfig } from "../config.js";
import { isNvidiaIntegrateApi, maskApiKey } from "../routing/config.js";

export { maskApiKey };

/** Gemini OpenAI-compatible endpoint（官方 docs/openai）；trailing slash 可有可無，載入時會 normalize。 */
export const DEFAULT_DIGEST_FALLBACK_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

export function isDigestLlmEnabled(): boolean {
  const flag = process.env.ENABLE_LLM_DIGEST?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export type DigestLlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Featured summarize 第二層（PR #30 起同 NVIDIA model；PR #34 起可跨 provider）。
   * 有 `fallbackModel` 時必須同時有 fallbackApiKey／fallbackBaseUrl。
   */
  fallbackModel?: string;
  fallbackApiKey?: string;
  fallbackBaseUrl?: string;
  /** Derived from fallbackBaseUrl；僅在 fallback 開啟時有值。 */
  fallbackPreferJsonResponseFormat?: boolean;
  fallbackDisableThinking?: boolean;
  maxFeatured: number;
  overflowShowTitleZh: boolean;
  maxPapersPerBatch: number;
  maxInputTokens: number;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  summarizeTimeoutMs: number;
  summarizeFallbackTimeoutMs: number;
  summarizeStageBudgetMs: number;
  summarizeMaxRetries: number;
  summarizeConcurrency: number;
  summarizeFallbackConcurrency: number;
  preferJsonResponseFormat: boolean;
  disableThinking: boolean;
};

export function resolveDigestProviderFlags(
  baseUrl: string,
  enableThinking: boolean,
): { preferJsonResponseFormat: boolean; disableThinking: boolean } {
  const nvidia = isNvidiaIntegrateApi(baseUrl);
  return {
    preferJsonResponseFormat: !nvidia,
    disableThinking: nvidia && !enableThinking,
  };
}

/**
 * Featured-summarize fallback endpoint view（PR #34）：換 key／baseUrl／model／flags，
 * 不能只改 model 字串還打 primary NVIDIA client。fallback 未開 → undefined。
 */
export function withDigestFallbackEndpoint(config: DigestLlmConfig): DigestLlmConfig | undefined {
  const model = config.fallbackModel?.trim();
  if (!model) return undefined;

  const apiKey = config.fallbackApiKey?.trim();
  const baseUrl = config.fallbackBaseUrl?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error(
      "Digest summarize fallback is misconfigured: DIGEST_LLM_FALLBACK_MODEL is set but " +
        "fallbackApiKey/fallbackBaseUrl are missing.",
    );
  }

  return {
    ...config,
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    preferJsonResponseFormat: config.fallbackPreferJsonResponseFormat ?? true,
    disableThinking: config.fallbackDisableThinking ?? false,
  };
}

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

  const fallbackModel = process.env.DIGEST_LLM_FALLBACK_MODEL?.trim() || undefined;
  const fallbackApiKey = process.env.DIGEST_LLM_FALLBACK_API_KEY?.trim() || undefined;
  const fallbackBaseUrlRaw =
    process.env.DIGEST_LLM_FALLBACK_BASE_URL?.trim() || DEFAULT_DIGEST_FALLBACK_BASE_URL;

  if (fallbackApiKey && !fallbackModel) {
    throw new Error(
      "DIGEST_LLM_FALLBACK_API_KEY is set but DIGEST_LLM_FALLBACK_MODEL is missing.",
    );
  }
  // Fail-closed（PR #34）：有 model 無 key（或相反）比靜默 fallback-off／誤用 primary key 更安全。
  if (fallbackModel && !fallbackApiKey) {
    throw new Error(
      "DIGEST_LLM_FALLBACK_MODEL is set but DIGEST_LLM_FALLBACK_API_KEY is missing. " +
        "Fallback is a separate provider endpoint (e.g. Gemini); do not reuse the primary NVIDIA key chain.",
    );
  }

  const baseUrl = file.baseUrl.replace(/\/$/, "");
  const primaryFlags = resolveDigestProviderFlags(baseUrl, file.enableThinking);

  let fallbackFields: Pick<
    DigestLlmConfig,
    | "fallbackModel"
    | "fallbackApiKey"
    | "fallbackBaseUrl"
    | "fallbackPreferJsonResponseFormat"
    | "fallbackDisableThinking"
  > = {};

  if (fallbackModel && fallbackApiKey) {
    const fallbackBaseUrl = fallbackBaseUrlRaw.replace(/\/$/, "");
    const fallbackFlags = resolveDigestProviderFlags(fallbackBaseUrl, file.enableThinking);
    fallbackFields = {
      fallbackModel,
      fallbackApiKey,
      fallbackBaseUrl,
      fallbackPreferJsonResponseFormat: fallbackFlags.preferJsonResponseFormat,
      fallbackDisableThinking: fallbackFlags.disableThinking,
    };
  }

  return {
    apiKey,
    baseUrl,
    model,
    ...fallbackFields,
    maxFeatured: file.maxFeatured,
    overflowShowTitleZh: file.overflowShowTitleZh,
    maxPapersPerBatch: file.maxPapersPerBatch,
    maxInputTokens: file.maxInputTokens,
    timeoutMs: file.timeoutMs,
    maxTokens: file.maxTokens,
    maxRetries: file.maxRetries,
    summarizeTimeoutMs: file.summarizeTimeoutMs,
    summarizeFallbackTimeoutMs: file.summarizeFallbackTimeoutMs,
    summarizeStageBudgetMs: file.summarizeStageBudgetMs,
    summarizeMaxRetries: file.summarizeMaxRetries,
    summarizeConcurrency: file.summarizeConcurrency,
    summarizeFallbackConcurrency: file.summarizeFallbackConcurrency,
    preferJsonResponseFormat: primaryFlags.preferJsonResponseFormat,
    disableThinking: primaryFlags.disableThinking,
  };
}
