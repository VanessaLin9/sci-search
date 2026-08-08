import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import {
  estimateRoutingCompletionTokens,
  resolveCompletionMaxTokens,
} from "../routing/batchSizing.js";
import type { RoutingLlmConfig } from "../routing/config.js";
import { createRoutingLlmClient } from "../routing/routingLlmClient.js";
import { formatElapsedMs } from "../routing/routingLog.js";
import { buildBiorxivGateCompletionParams } from "./gatePrompt.js";
import { logBiorxivGate } from "./gateLog.js";
import type { BiorxivGateInput } from "./types.js";

export type BiorxivGateCompletionCall = {
  completion: ChatCompletion;
  usedJsonResponseFormat: boolean;
  elapsedMs: number;
};

export { extractLlmJsonContent as extractBiorxivGateMessageContent } from "../llm/extractLlmJsonContent.js";

/** bioRxiv gate LLM 呼叫；與 routing 共用 response_format fallback mechanics。PR #21
 * Timing：gate=`biorxiv-gate` callSite=`callBiorxivGateCompletion`（PR #26）。
 * 每一發 HTTP 經 shared rate limiter，且 SDK maxRetries=0（PR #35）。
 */
export async function callBiorxivGateCompletion(
  items: BiorxivGateInput[],
  config: RoutingLlmConfig,
  options?: { label?: string; signal?: AbortSignal },
): Promise<BiorxivGateCompletionCall> {
  const client = createRoutingLlmClient(config);
  const label = options?.label ?? "biorxiv-gate-llm";
  const timingMeta = {
    gate: "biorxiv-gate",
    callSite: "callBiorxivGateCompletion",
  } as const;

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  logBiorxivGate(
    `${label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  return createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) =>
      client.chat.completions.create(
        buildBiorxivGateCompletionParams(items, config, useJsonResponseFormat, maxTokens),
        {
          timeout: config.timeoutMs,
          maxRetries: 0,
        },
      ),
    log: logBiorxivGate,
    label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    rateLimit: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      signal: options?.signal,
    },
  });
}
