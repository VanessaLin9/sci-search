/**
 * summarize / translate 用的 chat 呼叫。
 * tagging 請走 `callDigestTaggingCompletion`（共用 PR #21 response_format fallback）。
 *
 * NVIDIA 路徑通常 `preferJsonResponseFormat=false`：503 等只靠 client `maxRetries`，
 * 失敗直接 throw 給上層做 domain degrade（略過繁中／keyword）。
 *
 * 每發 HTTP 記 gate/callSite + duration/gap/60s 視窗（診斷快模型撞 RPM）；見 `llmRequestTiming.ts`。
 */
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
  type LlmRequestTimingMeta,
} from "../llm/llmRequestTiming.js";
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
    /** 邏輯閘標籤：digest-summarize / digest-translate / digest-probe */
    gate: string;
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
  const timingMeta: LlmRequestTimingMeta = {
    gate: options.gate,
    callSite: "callDigestChatCompletion",
  };

  logDigest(
    `${options.label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(max_tokens=${maxTokens}, need~${options.estimatedCompletionTokens}, cap=${config.maxTokens}, timeout=${timeoutMs}ms, retries=${maxRetries})`,
  );

  try {
    const completion = await timedDigestCreate(client, buildParams(maxTokens), options.label, timingMeta);
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
    const completion = await timedDigestCreate(client, buildParams(maxTokens), options.label, timingMeta);
    logDigest(`${options.label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
    return completion;
  }
}

async function timedDigestCreate(
  client: ReturnType<typeof createDigestLlmClient>,
  params: ChatCompletionCreateParamsNonStreaming,
  label: string,
  timingMeta: LlmRequestTimingMeta,
): Promise<ChatCompletion> {
  const timing = noteLlmRequestStart();
  try {
    const completion = await client.chat.completions.create(params);
    logDigest(`${label}: request ok · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
    return completion;
  } catch (error) {
    logDigest(`${label}: request failed · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
    throw error;
  }
}
