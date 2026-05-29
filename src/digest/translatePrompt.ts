import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { DIGEST_TRANSLATE_SYSTEM_PROMPT } from "../domain/life-science/prompts/translate.system.js";
import type { DigestLlmConfig } from "./config.js";
import type { DigestTranslateInput } from "./types.js";

export { DIGEST_TRANSLATE_SYSTEM_PROMPT };

export function buildDigestTranslateCompletionParams(
  items: DigestTranslateInput[],
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
      { role: "system", content: DIGEST_TRANSLATE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Translate each title to Traditional Chinese (Taiwan). Reply with JSON only.\n${JSON.stringify({ papers: items })}`,
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

export function estimateTranslateCompletionTokens(paperCount: number): number {
  if (paperCount === 0) return 0;
  return 120 + paperCount * 64;
}
