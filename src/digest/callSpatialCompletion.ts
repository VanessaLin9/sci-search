import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../llm/createChatCompletionWithJsonResponseFormatFallback.js";
import {
  estimateSpatialClassifyCompletionTokens,
} from "./spatialBatchSizing.js";
import { buildSpatialClassifyCompletionParams } from "./spatialPrompt.js";
import type { SpatialClassifyInput } from "./spatialTypes.js";
import { getRoutingLlmConfig, type RoutingLlmConfig } from "../routing/config.js";
import { createRoutingLlmClient } from "../routing/routingLlmClient.js";
import { resolveCompletionMaxTokens } from "../routing/batchSizing.js";
import { formatElapsedMs, logRouting } from "../routing/routingLog.js";

/**
 * Spatial confidence LLM call — uses ROUTING_LLM_MODEL / routing client.
 * Timing：gate=`spatial-classify` callSite=`callSpatialClassifyCompletion`.
 */
export async function callSpatialClassifyCompletion(
  items: SpatialClassifyInput[],
  config: RoutingLlmConfig = getRoutingLlmConfig(),
  options?: { label?: string; signal?: AbortSignal },
): Promise<ChatCompletion> {
  const client = createRoutingLlmClient(config);
  const label = options?.label ?? "spatial-classify";
  const timingMeta = {
    gate: "spatial-classify",
    callSite: "callSpatialClassifyCompletion",
  } as const;

  const estimated = estimateSpatialClassifyCompletionTokens(items.length);
  const maxTokens = resolveCompletionMaxTokens(estimated, config.maxTokens, config.maxTokens);

  logRouting(
    `${label}: POST chat/completions · gate=${timingMeta.gate} callSite=${timingMeta.callSite} ` +
      `(${items.length} paper(s), max_tokens=${maxTokens}, need~${estimated}, cap=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  const { completion } = await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    create: (useJsonResponseFormat) =>
      client.chat.completions.create(
        buildSpatialClassifyCompletionParams(items, config, useJsonResponseFormat, maxTokens),
        {
          timeout: config.timeoutMs,
          maxRetries: 0,
        },
      ),
    log: logRouting,
    label,
    formatElapsed: formatElapsedMs,
    timingMeta,
    jsonModeFailedRetryMessage: `${label}: json_object failed, retrying without response_format…`,
    rateLimit: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      signal: options?.signal,
    },
  });
  return completion;
}
