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

export { extractLlmJsonContent as extractRoutingMessageContent } from "../llm/extractLlmJsonContent.js";

export async function callRoutingCompletion(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  options?: { label?: string },
): Promise<RoutingCompletionCall> {
  const client = createRoutingLlmClient(config);
  const label = options?.label ?? "routing-llm";

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  logRouting(
    `${label}: POST chat/completions (${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  return createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) =>
      client.chat.completions.create(
        buildRoutingCompletionParams(items, config, useJsonResponseFormat, maxTokens),
      ),
    log: logRouting,
    label,
    formatElapsed: formatElapsedMs,
  });
}
