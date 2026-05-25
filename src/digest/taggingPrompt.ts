import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { DigestLlmConfig } from "./config.js";
import type { DigestTaggingInput } from "./types.js";

export const DIGEST_TAGGING_SYSTEM_PROMPT = `You assign each paper to a digest main-line bucket for a daily life-science email.

Buckets:
- "line-a": Single-cell, spatial omics, sc/snRNA-seq, spatial transcriptomics/proteomics, MERFISH, Xenium, Visium, multi-omics at single-cell resolution, related methods.
- "line-b": Other important life-science research (biology, medicine, neuroscience, immunology, cancer, development, evolution, microbiome, CRISPR, genomics, structural biology of biomolecules, etc.).
- "preprint": bioRxiv / medRxiv preprints (source_id biorxiv).
- "skip": Not life-science research, or non-research items (editorial, news, commentary, physics/chemistry/engineering/CS unless clearly AI-for-biology), or too vague to include.

Use title, journal, source scope, and abstract when present. Papers already passed a life-science gate; when unsure between line-a and line-b, prefer line-b.

OUTPUT FORMAT (strict):
- Reply with a single JSON object only. No markdown, no code fences, no preamble, no analysis, no reasoning.
- Start the response with the character { (first non-whitespace character).
- Schema: {"results":[{"id":"<paper id>","digest_line":"line-a"|"line-b"|"preprint"|"skip"}, ...]}
- Each row must include the exact input "id". You may also echo "title" for disambiguation.
- Include exactly one result per input paper.`;

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
