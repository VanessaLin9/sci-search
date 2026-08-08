import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import { resolveCompletionMaxTokens } from "../routing/batchSizing.js";
import { estimateDigestTaggingCompletionTokens } from "./batchSizing.js";
import type { DigestLlmConfig } from "./config.js";
import { createDigestLlmClient } from "./digestLlmClient.js";
import { formatElapsedMs, logDigest } from "./digestLog.js";
import { buildDigestTaggingCompletionParams } from "./taggingPrompt.js";
import type { DigestTaggingInput } from "./types.js";

/** Digest tagging LLM 呼叫；response_format 重試交給共用 helper，domain keyword fallback 仍在 `tagTitles`。PR #21
 * Timing：gate=`digest-tagging` callSite=`callDigestTaggingCompletion`（PR #26）。
 * 每一發 HTTP 經 shared rate limiter，且 SDK maxRetries=0（PR #35）。
 */
export async function callDigestTaggingCompletion(
  items: DigestTaggingInput[],
  config: DigestLlmConfig,
  options?: { label?: string; signal?: AbortSignal },
): Promise<ChatCompletion> {
  // Client maxRetries 也鎖 0：即使漏傳 per-request options，也不要 SDK 藏第二發（PR #35）。
  const client = createDigestLlmClient(config, { maxRetries: 0 });
  const label = options?.label ?? "digest-tag";
  const timingMeta = {
    gate: "digest-tagging",
    callSite: "callDigestTaggingCompletion",
  } as const;

  const estimated = estimateDigestTaggingCompletionTokens(items.length);
  // Reasoning-heavy models (e.g. step-3.5-flash) need headroom beyond compact JSON estimates.
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens, config.maxTokens);

  logDigest(
    `${label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  const { completion } = await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) =>
      client.chat.completions.create(
        buildDigestTaggingCompletionParams(items, config, useJsonResponseFormat, maxTokens),
        {
          timeout: config.timeoutMs,
          maxRetries: 0,
        },
      ),
    log: logDigest,
    label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    jsonModeFailedRetryMessage: `${label}: json_object failed, retrying without response_format…`,
    rateLimit: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      signal: options?.signal,
    },
  });
  return completion;
}
