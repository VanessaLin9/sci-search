/**
 * summarize / translate 用的 chat 呼叫。
 * tagging 請走 `callDigestTaggingCompletion`（共用 PR #21 response_format fallback）。
 *
 * `preferJsonResponseFormat=true` 時走共用 helper：先帶 json_object，供應商拒收再裸請求
 * （`create(useJson)` 必須真的開關 response_format；舊實作 retry 仍帶 format 是 bug）。
 *
 * NVIDIA 路徑通常 `preferJsonResponseFormat=false`：失敗直接 throw 給上層 degrade。
 *
 * 每發 HTTP 記 gate/callSite + duration/gap/60s 視窗（診斷快模型撞 RPM；PR #26）；見 `llmRequestTiming.ts`。
 */
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
  type LlmRequestTimingMeta,
} from "../llm/llmRequestTiming.js";
import { resolveCompletionMaxTokens } from "../routing/batchSizing.js";
import type { DigestLlmConfig } from "./config.js";
import { createDigestLlmClient } from "./digestLlmClient.js";
import { formatElapsedMs, logDigest } from "./digestLog.js";

export async function callDigestChatCompletion(
  config: DigestLlmConfig,
  buildParams: (
    maxTokens: number,
    useJsonResponseFormat: boolean,
  ) => ChatCompletionCreateParamsNonStreaming,
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

  const { completion } = await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: useJson,
    create: (useJsonResponseFormat) =>
      timedDigestCreate(
        client,
        buildParams(maxTokens, useJsonResponseFormat),
        options.label,
        timingMeta,
      ),
    log: logDigest,
    label: options.label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    jsonModeFailedRetryMessage: `${options.label}: json_object failed, retrying without response_format…`,
  });
  return completion;
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
