import type { ChatCompletion } from "openai/resources/chat/completions";
import { extractRoutingMessageContent } from "../routing/callRoutingCompletion.js";
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
  const startedAt = Date.now();
  const label = options?.label ?? "digest-tag";
  let usedJsonResponseFormat = config.preferJsonResponseFormat;

  const estimated = estimateDigestTaggingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens, 2048);

  logDigest(
    `${label}: POST chat/completions (${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  try {
    const completion = await client.chat.completions.create(
      buildDigestTaggingCompletionParams(items, config, usedJsonResponseFormat, maxTokens),
    );
    logDigest(`${label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
    return completion;
  } catch (error) {
    if (!config.preferJsonResponseFormat) {
      logDigest(`${label}: failed after ${formatElapsedMs(startedAt)}`);
      throw error;
    }

    logDigest(`${label}: json_object failed, retrying without response_format…`);
    const completion = await client.chat.completions.create(
      buildDigestTaggingCompletionParams(items, config, false, maxTokens),
    );
    logDigest(`${label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
    return completion;
  }
}

export { extractRoutingMessageContent as extractDigestMessageContent };
