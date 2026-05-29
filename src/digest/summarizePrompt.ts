import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { DIGEST_SUMMARIZE_SYSTEM_PROMPT } from "../domain/life-science/prompts/summarize.system.js";
import type { DigestLlmConfig } from "./config.js";
import type { DigestSummarizeInput } from "./types.js";

export { DIGEST_SUMMARIZE_SYSTEM_PROMPT };

export function buildDigestSummarizeCompletionParams(
  paper: DigestSummarizeInput,
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
      { role: "system", content: DIGEST_SUMMARIZE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Write featured-card fields for this paper. Reply with JSON only.\n${JSON.stringify({ paper })}`,
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

export function estimateSummarizeCompletionTokens(): number {
  return 720;
}
