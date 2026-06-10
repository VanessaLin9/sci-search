import type { ChatCompletion } from "openai/resources/chat/completions";
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
  const startedAt = Date.now();
  const label = options?.label ?? "biorxiv-gate-llm";
  let usedJsonResponseFormat = config.preferJsonResponseFormat;

  const estimated = estimateRoutingCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens);

  logBiorxivGate(
    `${label}: POST chat/completions (${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  let completion: ChatCompletion;
  try {
    completion = await client.chat.completions.create(
      buildBiorxivGateCompletionParams(items, config, usedJsonResponseFormat, maxTokens),
    );
  } catch (error) {
    if (!config.preferJsonResponseFormat) {
      logBiorxivGate(`${label}: failed after ${formatElapsedMs(startedAt)}`);
      throw error;
    }

    logBiorxivGate(`${label}: json_object mode failed, retrying without response_format…`);
    usedJsonResponseFormat = false;
    completion = await client.chat.completions.create(
      buildBiorxivGateCompletionParams(items, config, false, maxTokens),
    );
  }

  logBiorxivGate(`${label}: HTTP ok in ${formatElapsedMs(startedAt)}`);
  return {
    completion,
    usedJsonResponseFormat,
    elapsedMs: Date.now() - startedAt,
  };
}
