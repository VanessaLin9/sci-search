import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { SPATIAL_CLASSIFIER_SYSTEM_PROMPT } from "../domain/life-science/prompts/spatial.system.js";
import type { RoutingLlmConfig } from "../routing/config.js";
import type { SpatialClassifyInput } from "./spatialTypes.js";

export { SPATIAL_CLASSIFIER_SYSTEM_PROMPT };

export function buildSpatialClassifyCompletionParams(
  items: SpatialClassifyInput[],
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
      { role: "system", content: SPATIAL_CLASSIFIER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Score spatial_confidence for each paper. Reply with JSON only.\n${JSON.stringify({ papers: items })}`,
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
