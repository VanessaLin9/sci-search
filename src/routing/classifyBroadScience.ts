import { z } from "zod";
import type { LifeScienceRoutingVerdict } from "../types.js";
import {
  callRoutingCompletion,
  extractRoutingMessageContent,
} from "./callRoutingCompletion.js";
import { getRoutingLlmConfig, maskApiKey, type RoutingLlmConfig } from "./config.js";
import { parseJsonFromLlmContent } from "./parseLlmJson.js";
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

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
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
  const { completion } = await callRoutingCompletion(items, config, { label: batchLabel });

  const usage = completion.usage;
  const usageLine = usage
    ? `prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`
    : "usage n/a";

  const { content, usedReasoningFallback } = extractRoutingMessageContent(
    completion.choices[0]?.message,
  );
  if (usedReasoningFallback) {
    logRouting(
      `${batchLabel}: warning: model returned reasoning_content but empty content; used reasoning as fallback`,
    );
  }

  const parsed = llmResponseSchema.parse(parseJsonFromLlmContent(content));
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

  for (const row of parsed.results) {
    verdictById.set(row.id, row.verdict);
  }

  const missingIds = items.filter((item) => !verdictById.has(item.id)).map((item) => item.id);
  if (missingIds.length > 0) {
    throw new Error(`Routing LLM missing verdicts for: ${missingIds.join(", ")}`);
  }

  logRouting(`${batchLabel}: parsed (${usageLine}) · ${summarizeVerdicts(verdictById)}`);

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
