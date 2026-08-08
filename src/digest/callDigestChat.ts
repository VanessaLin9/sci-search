/**
 * summarize / translate 用的 chat 呼叫。
 * tagging 請走 `callDigestTaggingCompletion`（共用 PR #21 response_format fallback）。
 *
 * `preferJsonResponseFormat=true` 時走共用 helper：先帶 json_object，供應商拒收再裸請求
 * （PR #34：`create(useJson)` 必須真的開關 response_format；舊實作 retry 仍帶 format 是 bug，
 * Gemini fallback 會踩中）。
 *
 * json_object bare-retry 僅在 response_format 相容性失敗時觸發（PR #34 Codex P1／對齊 PR #28）；
 * 429／5xx／timeout 交回上層，避免 Gemini fallback 在 outage 時連打兩發。
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
import { isJsonResponseFormatCompatibilityFailure } from "../routing/isJsonResponseFormatCompatibilityFailure.js";
import { MIN_USEFUL_REQUEST_MS } from "../routing/routingBudget.js";
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
    /** Initial／default timeout when resolveRequestTimeoutMs is absent. */
    timeoutMs?: number;
    maxRetries?: number;
    /** Resolve timeout immediately before each HTTP create (incl. json_object bare-retry). */
    resolveRequestTimeoutMs?: () => number;
    /** Called once before each underlying HTTP create (including json_object bare-retry). */
    onRequestAttempt?: () => void;
    /**
     * Whether a failed json_object request may bare-retry.
     * Defaults to response-format compatibility failures only（PR #34／對齊 PR #28）。
     */
    shouldRetryWithoutJsonResponseFormat?: (error: unknown) => boolean;
  },
): Promise<ChatCompletion> {
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const client = createDigestLlmClient(config, {
    timeoutMs: options.timeoutMs ?? config.timeoutMs,
    maxRetries,
  });
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

  const resolveTimeoutMs = () =>
    options.resolveRequestTimeoutMs?.() ?? options.timeoutMs ?? config.timeoutMs;
  const initialTimeoutMs = resolveTimeoutMs();

  logDigest(
    `${options.label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(max_tokens=${maxTokens}, need~${options.estimatedCompletionTokens}, cap=${config.maxTokens}, timeout=${initialTimeoutMs}ms, retries=${maxRetries})`,
  );

  const { completion } = await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: useJson,
    create: (useJsonResponseFormat) => {
      options.onRequestAttempt?.();
      // 每次 create（含 json bare-retry）重算 timeout，避免第二發沿用過期 budget（PR #34）。
      const requestTimeoutMs = resolveTimeoutMs();
      if (requestTimeoutMs < MIN_USEFUL_REQUEST_MS) {
        throw new Error(
          `request budget exhausted before HTTP create (timeout=${requestTimeoutMs}ms)`,
        );
      }
      logDigest(
        `${options.label}: HTTP create · response_format=${useJsonResponseFormat ? "json_object" : "none"} ` +
          `timeout=${requestTimeoutMs}ms`,
      );
      return timedDigestCreate(
        client,
        buildParams(maxTokens, useJsonResponseFormat),
        options.label,
        timingMeta,
        { timeoutMs: requestTimeoutMs, maxRetries: 0 },
      );
    },
    log: logDigest,
    label: options.label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    jsonModeFailedRetryMessage: `${options.label}: json_object failed, retrying without response_format…`,
    // 429／5xx／timeout 交回 summarize／translate 政策；只有 response_format 相容性失敗才立刻裸重試。
    shouldRetryWithoutJsonResponseFormat:
      options.shouldRetryWithoutJsonResponseFormat ?? isJsonResponseFormatCompatibilityFailure,
  });
  return completion;
}

async function timedDigestCreate(
  client: ReturnType<typeof createDigestLlmClient>,
  params: ChatCompletionCreateParamsNonStreaming,
  label: string,
  timingMeta: LlmRequestTimingMeta,
  requestOptions: { timeoutMs: number; maxRetries: number },
): Promise<ChatCompletion> {
  const timing = noteLlmRequestStart();
  try {
    const completion = await client.chat.completions.create(params, {
      timeout: requestOptions.timeoutMs,
      maxRetries: requestOptions.maxRetries,
    });
    logDigest(`${label}: request ok · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
    return completion;
  } catch (error) {
    logDigest(`${label}: request failed · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
    throw error;
  }
}
