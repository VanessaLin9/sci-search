import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { DIGEST_TAGGING_SYSTEM_PROMPT } from "../domain/life-science/prompts/tagging.system.js";
import type { DigestLlmConfig } from "./config.js";
import type { DigestTaggingInput } from "./types.js";

export { DIGEST_TAGGING_SYSTEM_PROMPT };

export function buildDigestTaggingCompletionParams(
  items: DigestTaggingInput[],
  config: DigestLlmConfig,
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
      { role: "system", content: DIGEST_TAGGING_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Assign digest_line for each paper. Reply with JSON only.\n${JSON.stringify({ papers: items })}`,
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
