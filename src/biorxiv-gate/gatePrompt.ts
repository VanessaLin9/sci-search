import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { RoutingLlmConfig } from "../routing/config.js";
import { BIORXIV_GATE_SYSTEM_PROMPT } from "./prompts/gate.system.js";
import type { BiorxivGateInput } from "./types.js";

export { BIORXIV_GATE_SYSTEM_PROMPT };

export function buildBiorxivGateCompletionParams(
  items: BiorxivGateInput[],
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
      { role: "system", content: BIORXIV_GATE_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Classify each preprint. Reply with JSON only (no other text).\n` +
          `${JSON.stringify({ papers: items })}`,
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
