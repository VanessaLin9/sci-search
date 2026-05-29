import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { ROUTING_SYSTEM_PROMPT } from "../domain/life-science/prompts/routing.system.js";
import type { RoutingLlmConfig } from "./config.js";
import type { BroadScienceRoutingInput } from "./types.js";

export { ROUTING_SYSTEM_PROMPT };

export function buildRoutingCompletionParams(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  useJsonResponseFormat: boolean,
  maxTokensOverride?: number,
): ChatCompletionCreateParamsNonStreaming {
  const params: ChatCompletionCreateParamsNonStreaming & {
    chat_template_kwargs?: { enable_thinking?: boolean; clear_thinking?: boolean };
  } = {
    model: config.model,
    temperature: 0,
    stream: false,
    max_tokens: maxTokensOverride ?? config.maxTokens,
    messages: [
      { role: "system", content: ROUTING_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Classify each paper. Reply with JSON only (no other text).\n${JSON.stringify({ papers: items })}`,
      },
    ],
  };

  if (useJsonResponseFormat) {
    params.response_format = { type: "json_object" };
  }

  if (config.disableThinking) {
    params.chat_template_kwargs = { enable_thinking: false, clear_thinking: true };
  }

  return params;
}
