import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { RoutingLlmConfig } from "./config.js";
import type { BroadScienceRoutingInput } from "./types.js";

export const ROUTING_SYSTEM_PROMPT = `You classify scientific papers for a life-science daily digest pipeline.

Given only id, title, journal, and source_id (no abstract), decide whether each paper belongs to the life sciences.

Life sciences include: biology, medicine, neuroscience, immunology, microbiology, genetics, genomics, ecology, evolution, biotechnology, bioinformatics, structural biology of biomolecules, plant science, virology, epidemiology, and related biomedical research.

NOT life sciences (answer "no"): physics, astronomy, chemistry (non-biochemical), materials science, engineering, computer science (unless clearly AI-for-biology), mathematics, geology/planetary science, pure news/commentary/editorial/career pieces with no research content.

Answer "not_sure" when the title is too vague to tell (e.g. generic methods without field, ambiguous interdisciplinary titles).

OUTPUT FORMAT (strict):
- Reply with a single JSON object only. No markdown, no code fences, no preamble, no explanation, no reasoning, no commentary.
- Do not analyze papers in prose. Do not repeat titles. Output verdicts only.
- Schema: {"results":[{"id":"<paper id>","verdict":"yes"|"no"|"not_sure"}, ...]}
- Include exactly one result per input paper, using the same id.`;

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
