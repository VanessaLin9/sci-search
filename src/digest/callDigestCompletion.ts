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
 */
export async function callDigestTaggingCompletion(
  items: DigestTaggingInput[],
  config: DigestLlmConfig,
  options?: { label?: string },
): Promise<ChatCompletion> {
  const client = createDigestLlmClient(config);
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
      ),
    log: logDigest,
    label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    jsonModeFailedRetryMessage: `${label}: json_object failed, retrying without response_format…`,
  });
  return completion;
}
