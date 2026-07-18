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

export async function callBiorxivGateCompletion(
  items: BiorxivGateInput[],
  config: RoutingLlmConfig,
  options?: { label?: string },
): Promise<BiorxivGateCompletionCall> {
  const client = createRoutingLlmClient(config);
  const label = options?.label ?? "biorxiv-gate-llm";

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  logBiorxivGate(
    `${label}: POST chat/completions (${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  return createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) =>
      client.chat.completions.create(
        buildBiorxivGateCompletionParams(items, config, useJsonResponseFormat, maxTokens),
      ),
    log: logBiorxivGate,
    label,
    formatElapsed: formatElapsedMs,
  });
}
