import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";
import type { LifeScienceRoutingVerdict } from "../types.js";
import { getRoutingLlmConfig, maskApiKey, type RoutingLlmConfig } from "./config.js";
import { parseJsonFromLlmContent } from "./parseLlmJson.js";
import { createRoutingLlmClient } from "./routingLlmClient.js";
import { formatElapsedMs, logRouting } from "./routingLog.js";
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
    max_tokens: config.maxTokens,
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

  const reasoning = message?.reasoning_content?.trim();
  if (reasoning) {
    logRouting(
      "warning: model returned reasoning_content but empty content; using reasoning as fallback",
    );
    return reasoning;
  }

  throw new Error("Routing LLM returned empty message content");
}

function summarizeVerdicts(verdictById: Map<string, LifeScienceRoutingVerdict>): string {
  let yes = 0;
  let notSure = 0;
  let no = 0;
  for (const verdict of verdictById.values()) {
    if (verdict === "yes") yes += 1;
    else if (verdict === "not_sure") notSure += 1;
    else no += 1;
  }
  return `yes ${yes}, not_sure ${notSure}, no ${no}`;
}

async function classifyBatch(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  const client = createRoutingLlmClient(config);
  const startedAt = Date.now();
  let completion;

  logRouting(
    `${batchLabel}: POST chat/completions (${items.length} papers, max_tokens=${config.maxTokens}, timeout=${config.timeoutMs}ms)`,
  );

  try {
    completion = await client.chat.completions.create(
      buildCompletionParams(items, config, config.preferJsonResponseFormat),
    );
  } catch (error) {
    if (!config.preferJsonResponseFormat) {
      logRouting(`${batchLabel}: failed after ${formatElapsedMs(startedAt)}`);
      throw error;
    }

    logRouting(`${batchLabel}: json_object mode failed, retrying without response_format…`);
    completion = await client.chat.completions.create(
      buildCompletionParams(items, config, false),
    );
  }

  const usage = completion.usage;
  const usageLine = usage
    ? `prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`
    : "usage n/a";

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

  logRouting(
    `${batchLabel}: done in ${formatElapsedMs(startedAt)} (${usageLine}) · ${summarizeVerdicts(verdictById)}`,
  );

  return verdictById;
}

export async function classifyBroadSciencePapers(
  items: BroadScienceRoutingInput[],
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  if (items.length === 0) return new Map();

  const config = getRoutingLlmConfig();
  const batches = chunk(items, config.batchSize);
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

  logRouting(
    `LLM config: model=${config.model} base=${config.baseUrl} key=${maskApiKey(config.apiKey)} ` +
      `batchSize=${config.batchSize} batches=${batches.length} thinking=${config.disableThinking ? "off" : "on"}`,
  );
  logRouting(`classifying ${items.length} broad-science paper(s)…`);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel = `batch ${index + 1}/${batches.length}`;
    const batchVerdicts = await classifyBatch(batch, config, batchLabel);
    for (const [id, verdict] of batchVerdicts) {
      verdictById.set(id, verdict);
    }
  }

  logRouting(`finished all batches · ${summarizeVerdicts(verdictById)}`);
  return verdictById;
}
