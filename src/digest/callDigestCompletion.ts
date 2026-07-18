import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import { resolveCompletionMaxTokens } from "../routing/batchSizing.js";
import { estimateDigestTaggingCompletionTokens } from "./batchSizing.js";
import type { DigestLlmConfig } from "./config.js";
import { createDigestLlmClient } from "./digestLlmClient.js";
import { formatElapsedMs, logDigest } from "./digestLog.js";
import { buildDigestTaggingCompletionParams } from "./taggingPrompt.js";
import type { DigestTaggingInput } from "./types.js";

export async function callDigestTaggingCompletion(
  items: DigestTaggingInput[],
  config: DigestLlmConfig,
  options?: { label?: string },
): Promise<ChatCompletion> {
  const client = createDigestLlmClient(config);
  const label = options?.label ?? "digest-tag";

  const estimated = estimateDigestTaggingCompletionTokens(items.length);
  // Reasoning-heavy models (e.g. step-3.5-flash) need headroom beyond compact JSON estimates.
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens, config.maxTokens);

  logDigest(
    `${label}: POST chat/completions (${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
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
    jsonModeFailedRetryMessage: `${label}: json_object failed, retrying without response_format…`,
  });
  return completion;
}
