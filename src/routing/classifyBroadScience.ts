import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";
import type { LifeScienceRoutingVerdict } from "../types.js";
import { getRoutingLlmConfig, type RoutingLlmConfig } from "./config.js";
import { parseJsonFromLlmContent } from "./parseLlmJson.js";
import { createRoutingLlmClient } from "./routingLlmClient.js";
import type { BroadScienceRoutingInput } from "./types.js";

const verdictSchema = z.enum(["yes", "no", "not_sure"]);

const llmResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: verdictSchema,
    }),
  ),
});

const SYSTEM_PROMPT = `You classify scientific papers for a life-science daily digest pipeline.

Given only id, title, journal, and source_id (no abstract), decide whether each paper belongs to the life sciences.

Life sciences include: biology, medicine, neuroscience, immunology, microbiology, genetics, genomics, ecology, evolution, biotechnology, bioinformatics, structural biology of biomolecules, plant science, virology, epidemiology, and related biomedical research.

NOT life sciences (answer "no"): physics, astronomy, chemistry (non-biochemical), materials science, engineering, computer science (unless clearly AI-for-biology), mathematics, geology/planetary science, pure news/commentary/editorial/career pieces with no research content.

Answer "not_sure" when the title is too vague to tell (e.g. generic methods without field, ambiguous interdisciplinary titles).

Respond with JSON only, matching this schema:
{"results":[{"id":"<paper id>","verdict":"yes"|"no"|"not_sure"}, ...]}

Include exactly one result per input paper, using the same id.`;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function buildCompletionParams(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  useJsonResponseFormat: boolean,
): ChatCompletionCreateParamsNonStreaming {
  const params: ChatCompletionCreateParamsNonStreaming & {
    chat_template_kwargs?: { enable_thinking?: boolean; clear_thinking?: boolean };
  } = {
    model: config.model,
    temperature: 0,
    stream: false,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ papers: items }),
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

function extractMessageContent(
  message: { content?: string | null; reasoning_content?: string | null } | undefined,
): string {
  const content = message?.content?.trim();
  if (content) return content;

  throw new Error("Routing LLM returned empty message content");
}

async function classifyBatch(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  const client = createRoutingLlmClient(config);
  let completion;

  try {
    completion = await client.chat.completions.create(
      buildCompletionParams(items, config, config.preferJsonResponseFormat),
    );
  } catch (error) {
    if (!config.preferJsonResponseFormat) throw error;

    completion = await client.chat.completions.create(
      buildCompletionParams(items, config, false),
    );
  }

  const content = extractMessageContent(completion.choices[0]?.message);
  const parsed = llmResponseSchema.parse(parseJsonFromLlmContent(content));
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

  for (const row of parsed.results) {
    verdictById.set(row.id, row.verdict);
  }

  const missingIds = items.filter((item) => !verdictById.has(item.id)).map((item) => item.id);
  if (missingIds.length > 0) {
    throw new Error(`Routing LLM missing verdicts for: ${missingIds.join(", ")}`);
  }

  return verdictById;
}

export async function classifyBroadSciencePapers(
  items: BroadScienceRoutingInput[],
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  if (items.length === 0) return new Map();

  const config = getRoutingLlmConfig();
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

  for (const batch of chunk(items, config.batchSize)) {
    const batchVerdicts = await classifyBatch(batch, config);
    for (const [id, verdict] of batchVerdicts) {
      verdictById.set(id, verdict);
    }
  }

  return verdictById;
}
