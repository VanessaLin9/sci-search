import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { DigestLlmConfig } from "./config.js";
import type { DigestSummarizeInput } from "./types.js";

export const DIGEST_SUMMARIZE_SYSTEM_PROMPT = `You write featured-card copy for a daily life-science email digest.

Given one paper (English title, journal, main line, optional abstract), produce:
- title_zh: concise Traditional Chinese (Taiwan) title for the subtitle under the English headline
- summary_zh: 3–5 sentences in Traditional Chinese (Taiwan), explaining why the paper matters; use the abstract when present
- topic_tags: 2–5 short English tags (lowercase, hyphenated where natural, e.g. "single-cell", "cancer", "neuroscience"); no Chinese in tags

OUTPUT FORMAT (strict):
- Reply with a single JSON object only. No markdown, no code fences, no preamble.
- Start the response with { (first non-whitespace character).
- Schema: {"id":"<paper id>","title_zh":"...","summary_zh":"...","topic_tags":["..."]}
- Use the exact input id.`;

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
