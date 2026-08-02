import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import type { RoutingLlmConfig } from "./config.js";
import { buildRoutingCompletionParams } from "./routingPrompt.js";
import { createRoutingLlmClient } from "./routingLlmClient.js";
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
  /** Called once before each underlying HTTP create (including json_object fallback). */
  onRequestAttempt?: () => void;
};

export { extractLlmJsonContent as extractRoutingMessageContent } from "../llm/extractLlmJsonContent.js";

/** Routing LLM 呼叫；response_format 重試交給共用 helper，domain fallback 仍在 classify。PR #21
 * Timing：gate=`life-science-routing` callSite=`callRoutingCompletion`（PR #26）。
 * Per-request timeout / maxRetries=0：app 擁有 retry 與 stage budget（routing resilience）。
 */
export async function callRoutingCompletion(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  options?: CallRoutingCompletionOptions,
): Promise<RoutingCompletionCall> {
  const client = createRoutingLlmClient(config);
  const label = options?.label ?? "routing-llm";
  const requestTimeoutMs = options?.requestTimeoutMs ?? config.timeoutMs;
  const timingMeta = {
    gate: "life-science-routing",
    callSite: "callRoutingCompletion",
  } as const;

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  // POST 列也帶 gate/callSite，方便 Actions log 與 request ok/failed 對齊過濾。PR #26
  logRouting(
    `${label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, ` +
      `timeout=${requestTimeoutMs}ms)`,
  );

  return createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) => {
      options?.onRequestAttempt?.();
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
  });
}
