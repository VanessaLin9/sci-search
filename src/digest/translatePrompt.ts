import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { DigestLlmConfig } from "./config.js";
import type { DigestTranslateInput } from "./types.js";

export const DIGEST_TRANSLATE_SYSTEM_PROMPT = `You translate English paper titles to Traditional Chinese (Taiwan) for a digest overflow list.

Rules:
- One concise Chinese title per paper; keep scientific terms accurate.
- Do not add summaries or commentary.

OUTPUT FORMAT (strict):
- Reply with a single JSON object only. No markdown, no code fences, no preamble.
- Start the response with { (first non-whitespace character).
- Schema: {"results":[{"id":"<paper id>","title_zh":"..."}, ...]}
- Include exactly one result per input paper, using the same id.`;

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
