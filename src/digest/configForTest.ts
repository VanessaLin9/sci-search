import { loadDigestFileConfig } from "../config.js";
import { getDigestLlmConfig, type DigestLlmConfig } from "./config.js";
import { readLlmProviderProfileId, resolveLlmProviderProfile } from "../llm/llmProviderProfile.js";
import { getRoutingLlmConfig } from "../routing/config.js";

/** One-off digest LLM config: reuse routing credentials (same .env as test-routing-llm). */
export function getDigestLlmConfigForTest(options?: {
  modelOverride?: string;
  useRoutingEnv?: boolean;
}): DigestLlmConfig {
  if (!options?.useRoutingEnv) {
    const config = getDigestLlmConfig();
    if (options?.modelOverride) {
      config.model = options.modelOverride;
    }
    return config;
  }

  const routing = getRoutingLlmConfig();
  const file = loadDigestFileConfig();
  const providerProfile = resolveLlmProviderProfile({
    baseUrl: file.baseUrl,
    profileId: readLlmProviderProfileId("DIGEST_LLM_PROFILE"),
    enableThinking: file.enableThinking,
  });

  return {
    apiKey: routing.apiKey,
    baseUrl: file.baseUrl,
    model: options?.modelOverride ?? routing.model,
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
    preferJsonResponseFormat: providerProfile.preferJsonResponseFormat,
    disableThinking: providerProfile.disableThinking,
    providerProfile,
  };
}
