import type { ChatCompletion } from "openai/resources/chat/completions";
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
  const startedAt = Date.now();
  const label = options?.label ?? "routing-llm";
  let usedJsonResponseFormat = config.preferJsonResponseFormat;

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  logRouting(
    `${label}: POST chat/completions (${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  let completion: ChatCompletion;
  try {
    completion = await client.chat.completions.create(
      buildRoutingCompletionParams(items, config, usedJsonResponseFormat, maxTokens),
    );
  } catch (error) {
    if (!config.preferJsonResponseFormat) {
      logRouting(`${label}: failed after ${formatElapsedMs(startedAt)}`);
      throw error;
    }

    logRouting(`${label}: json_object mode failed, retrying without response_format…`);
    usedJsonResponseFormat = false;
    completion = await client.chat.completions.create(
      buildRoutingCompletionParams(items, config, false, maxTokens),
    );
  }

  logRouting(`${label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
  return {
    completion,
    usedJsonResponseFormat,
    elapsedMs: Date.now() - startedAt,
  };
}
