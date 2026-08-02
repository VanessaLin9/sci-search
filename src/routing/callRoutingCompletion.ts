import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import type { RoutingLlmConfig } from "./config.js";
import { buildRoutingCompletionParams } from "./routingPrompt.js";
import { createRoutingLlmClient } from "./routingLlmClient.js";
import { isJsonResponseFormatCompatibilityFailure } from "./isJsonResponseFormatCompatibilityFailure.js";
import { formatElapsedMs, logRouting } from "./routingLog.js";
import {
  estimateRoutingCompletionTokens,
  resolveCompletionMaxTokens,
} from "./batchSizing.js";
import type { BroadScienceRoutingInput } from "./types.js";

export type RoutingCompletionCall = {
  completion: ChatCompletion;
  usedJsonResponseFormat: boolean;
  elapsedMs: number;
};

export type CallRoutingCompletionOptions = {
  label?: string;
  /** Per-request timeout clipped by remaining routing-stage budget. */
  requestTimeoutMs?: number;
  /** Resolve timeout immediately before each HTTP create (incl. json_object fallback). */
  resolveRequestTimeoutMs?: () => number;
  /** Called once before each underlying HTTP create (including json_object fallback). */
  onRequestAttempt?: () => void;
  /**
   * Whether a failed json_object request may bare-retry.
   * Defaults to response-format compatibility failures only（PR #28）.
   */
  shouldRetryWithoutJsonResponseFormat?: (error: unknown) => boolean;
};

export { extractLlmJsonContent as extractRoutingMessageContent } from "../llm/extractLlmJsonContent.js";

/** Routing LLM 呼叫；response_format 重試交給共用 helper，domain fallback 仍在 classify。PR #21
 * Timing：gate=`life-science-routing` callSite=`callRoutingCompletion`（PR #26）。
 * Per-request timeout 受 stage remaining budget 截短，且 `maxRetries=0` 避免 SDK 與 domain retry 疊加（PR #28）。
 * json_object fallback 僅在相容性失敗時觸發，且每次 create 重新取 timeout（PR #28）。
 */
export async function callRoutingCompletion(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  options?: CallRoutingCompletionOptions,
): Promise<RoutingCompletionCall> {
  const client = createRoutingLlmClient(config);
  const label = options?.label ?? "routing-llm";
  const timingMeta = {
    gate: "life-science-routing",
    callSite: "callRoutingCompletion",
  } as const;

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  const resolveTimeoutMs = () =>
    options?.resolveRequestTimeoutMs?.() ?? options?.requestTimeoutMs ?? config.timeoutMs;

  const initialTimeoutMs = resolveTimeoutMs();

  // POST 列也帶 gate/callSite，方便 Actions log 與 request ok/failed 對齊過濾。PR #26
  logRouting(
    `${label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, ` +
      `timeout=${initialTimeoutMs}ms)`,
  );

  return createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) => {
      options?.onRequestAttempt?.();
      // 每次 create（含 json fallback）重算 timeout，避免第二發沿用過期 budget（PR #28）
      const requestTimeoutMs = resolveTimeoutMs();
      logRouting(
        `${label}: HTTP create · response_format=${useJsonResponseFormat ? "json_object" : "none"} ` +
          `timeout=${requestTimeoutMs}ms`,
      );
      return client.chat.completions.create(
        buildRoutingCompletionParams(items, config, useJsonResponseFormat, maxTokens),
        {
          timeout: requestTimeoutMs,
          maxRetries: 0,
        },
      );
    },
    log: logRouting,
    label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    // timeout／429／5xx 等交回 classify 政策；只有 response_format 相容性失敗才立刻裸重試（PR #28）
    shouldRetryWithoutJsonResponseFormat:
      options?.shouldRetryWithoutJsonResponseFormat ?? isJsonResponseFormatCompatibilityFailure,
  });
}
