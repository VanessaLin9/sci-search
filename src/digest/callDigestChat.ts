import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { resolveCompletionMaxTokens } from "../routing/batchSizing.js";
import type { DigestLlmConfig } from "./config.js";
import { createDigestLlmClient } from "./digestLlmClient.js";
import { formatElapsedMs, logDigest } from "./digestLog.js";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function callDigestChatCompletion(
  config: DigestLlmConfig,
  buildParams: (maxTokens: number) => ChatCompletionCreateParamsNonStreaming,
  options: {
    label: string;
    estimatedCompletionTokens: number;
    completionFloor?: number;
    preferJsonResponseFormat?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
  },
): Promise<ChatCompletion> {
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const client = createDigestLlmClient(config, { timeoutMs, maxRetries });
  const startedAt = Date.now();
  const floor = options.completionFloor ?? config.maxTokens;
  const maxTokens = resolveCompletionMaxTokens(
    options.estimatedCompletionTokens,
    config.maxTokens,
    floor,
  );
  const useJson = options.preferJsonResponseFormat ?? config.preferJsonResponseFormat;

  logDigest(
    `${options.label}: POST chat/completions (max_tokens=${maxTokens}, need~${options.estimatedCompletionTokens}, cap=${config.maxTokens}, timeout=${timeoutMs}ms, retries=${maxRetries})`,
  );

  try {
    const completion = await client.chat.completions.create(buildParams(maxTokens));
    logDigest(`${options.label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
    return completion;
  } catch (error) {
    const detail = formatError(error);
    const attempts = maxRetries + 1;
    const maxWaitHint =
      attempts > 1 ? ` (up to ~${Math.round((timeoutMs * attempts) / 60000)}m with retries)` : "";
    logDigest(`${options.label}: failed after ${formatElapsedMs(startedAt)}${maxWaitHint}: ${detail}`);

    if (!useJson) {
      throw error;
    }

    logDigest(`${options.label}: json_object failed, retrying without response_format…`);
    const completion = await client.chat.completions.create(buildParams(maxTokens));
    logDigest(`${options.label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
    return completion;
  }
}
