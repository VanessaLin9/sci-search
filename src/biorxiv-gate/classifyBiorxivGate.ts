import { z } from "zod";
import {
  isRoutingMissingVerdictsError,
  shouldRetrySplitLlmBatch,
} from "../llm/extractLlmJsonContent.js";
import { buildMissingVerdictRetryBatch } from "../routing/classifyBroadScience.js";
import { getRoutingLlmConfig, maskApiKey, type RoutingLlmConfig } from "../routing/config.js";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { planBiorxivGateBatches } from "./batchSizing.js";
import {
  callBiorxivGateCompletion,
  extractBiorxivGateMessageContent,
} from "./callGateCompletion.js";
import { logBiorxivGate } from "./gateLog.js";
import { BIORXIV_GATE_VERDICTS, type BiorxivGateInput, type BiorxivGateVerdict } from "./types.js";

const verdictSchema = z.enum(BIORXIV_GATE_VERDICTS);

const llmResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: verdictSchema,
    }),
  ),
});

type ClassifyBatchOptions = {
  allowMissingVerdictRetry?: boolean;
};

type ParsedBatchResult = {
  verdictById: Map<string, BiorxivGateVerdict>;
  missingIds: string[];
  finishReason: string;
  usageLine: string;
  parsedResultCount: number;
};

function summarizeVerdicts(verdictById: Map<string, BiorxivGateVerdict>): string {
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

function logMissingVerdictDiagnostic(
  batchLabel: string,
  options: {
    missingIds: string[];
    totalCount: number;
    finishReason: string;
    usageLine: string;
    parsedResultCount: number;
  },
): void {
  logBiorxivGate(
    `${batchLabel}: missing ${options.missingIds.length}/${options.totalCount} verdict(s) ` +
      `(finish_reason=${options.finishReason}, ${options.usageLine}, parsed=${options.parsedResultCount}): ` +
      `${options.missingIds.join(", ")}`,
  );
}

function assertCompleteVerdicts(
  items: BiorxivGateInput[],
  verdictById: Map<string, BiorxivGateVerdict>,
  batchLabel: string,
): void {
  const missingIds = items.filter((item) => !verdictById.has(item.id)).map((item) => item.id);
  if (missingIds.length === 0) return;
  throw new Error(
    `${batchLabel}: incomplete bioRxiv gate verdicts for ${missingIds.join(", ")}`,
  );
}

async function classifyBatch(
  items: BiorxivGateInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
  options: ClassifyBatchOptions = {},
): Promise<Map<string, BiorxivGateVerdict>> {
  const { allowMissingVerdictRetry = true } = options;

  try {
    const parsed = await classifyBatchOnce(items, config, batchLabel);

    if (parsed.missingIds.length === 0) {
      logBiorxivGate(`${batchLabel}: parsed (${parsed.usageLine}) · ${summarizeVerdicts(parsed.verdictById)}`);
      return parsed.verdictById;
    }

    logMissingVerdictDiagnostic(batchLabel, {
      missingIds: parsed.missingIds,
      totalCount: items.length,
      finishReason: parsed.finishReason,
      usageLine: parsed.usageLine,
      parsedResultCount: parsed.parsedResultCount,
    });

    if (!allowMissingVerdictRetry) {
      assertCompleteVerdicts(items, parsed.verdictById, batchLabel);
      return parsed.verdictById;
    }

    const retryItems = buildMissingVerdictRetryBatch(items, parsed.missingIds);
    logBiorxivGate(
      `${batchLabel}: missing-retry ${retryItems.length} paper(s) (from ${parsed.missingIds.length} missing)`,
    );

    const retryVerdicts = await classifyBatch(retryItems, config, `${batchLabel} missing-retry`, {
      allowMissingVerdictRetry: false,
    });

    const verdictById = new Map(parsed.verdictById);
    const originallyMissing = new Set(parsed.missingIds);
    for (const [id, verdict] of retryVerdicts) {
      if (originallyMissing.has(id)) {
        verdictById.set(id, verdict);
      }
    }

    assertCompleteVerdicts(items, verdictById, batchLabel);
    logBiorxivGate(`${batchLabel}: parsed (${parsed.usageLine}) · ${summarizeVerdicts(verdictById)}`);
    return verdictById;
  } catch (error) {
    if (isRoutingMissingVerdictsError(error)) {
      throw error;
    }

    const finishReason =
      error instanceof Error && "finishReason" in error
        ? String((error as Error & { finishReason: string }).finishReason)
        : "unknown";
    if (items.length <= 1 || !shouldRetrySplitLlmBatch(error, finishReason)) {
      throw error;
    }

    const mid = Math.ceil(items.length / 2);
    logBiorxivGate(`${batchLabel}: split retry ${items.length} → ${mid} + ${items.length - mid}`);
    const first = await classifyBatch(items.slice(0, mid), config, `${batchLabel}a`);
    const second = await classifyBatch(items.slice(mid), config, `${batchLabel}b`);
    return new Map([...first, ...second]);
  }
}

async function classifyBatchOnce(
  items: BiorxivGateInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
): Promise<ParsedBatchResult> {
  const { completion } = await callBiorxivGateCompletion(items, config, { label: batchLabel });

  const usage = completion.usage;
  const usageLine = usage
    ? `prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`
    : "usage n/a";

  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";

  let content: string;
  let usedReasoningFallback: boolean;
  try {
    ({ content, usedReasoningFallback } = extractBiorxivGateMessageContent(completion.choices[0]?.message));
  } catch (extractError) {
    if (items.length > 1 && shouldRetrySplitLlmBatch(extractError, finishReason)) {
      throw attachFinishReason(extractError, finishReason);
    }
    throw extractError;
  }

  if (usedReasoningFallback) {
    logBiorxivGate(`${batchLabel}: warning: JSON taken from reasoning_content`);
  }

  let parsed;
  try {
    parsed = llmResponseSchema.parse(parseJsonFromLlmContent(content));
  } catch (parseError) {
    const preview = content.slice(0, 400);
    const wrapped = new Error(
      `${batchLabel}: invalid JSON (finish_reason=${finishReason}, ${content.length} chars): ${preview}${content.length > 400 ? "…" : ""}`,
      { cause: parseError },
    );
    if (items.length > 1 && shouldRetrySplitLlmBatch(wrapped, finishReason)) {
      throw attachFinishReason(wrapped, finishReason);
    }
    throw wrapped;
  }

  const verdictById = new Map<string, BiorxivGateVerdict>();
  for (const row of parsed.results) {
    verdictById.set(row.id, row.verdict);
  }

  const missingIds = items.filter((item) => !verdictById.has(item.id)).map((item) => item.id);

  return {
    verdictById,
    missingIds,
    finishReason,
    usageLine,
    parsedResultCount: parsed.results.length,
  };
}

function attachFinishReason(error: unknown, finishReason: string): Error {
  if (error instanceof Error) {
    return Object.assign(error, { finishReason });
  }
  return Object.assign(new Error(String(error)), { finishReason });
}

export async function classifyBiorxivGatePapers(
  items: BiorxivGateInput[],
): Promise<Map<string, BiorxivGateVerdict>> {
  if (items.length === 0) return new Map();

  const config = getRoutingLlmConfig();
  const { batches, estimatedInputTokens, estimatedCompletionTokens } = planBiorxivGateBatches(
    items,
    {
      maxInputTokens: config.maxInputTokens,
      maxCompletionTokens: config.maxTokens,
      maxPapersPerBatch: config.maxPapersPerBatch,
    },
  );
  const verdictById = new Map<string, BiorxivGateVerdict>();

  const batchSummary = batches
    .map(
      (batch, index) =>
        `${batch.length} papers (~${estimatedInputTokens[index]} tok in, ~${estimatedCompletionTokens[index]} tok out)`,
    )
    .join(", ");

  logBiorxivGate(
    `LLM config: model=${config.model} base=${config.baseUrl} key=${maskApiKey(config.apiKey)} ` +
      `maxInput=${config.maxInputTokens} maxCompletion=${config.maxTokens} maxPapers=${config.maxPapersPerBatch} thinking=${config.disableThinking ? "off" : "on"}`,
  );
  logBiorxivGate(
    `classifying ${items.length} candidate(s) in ${batches.length} batch(es): ${batchSummary}`,
  );

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel = `batch ${index + 1}/${batches.length}`;
    const batchVerdicts = await classifyBatch(batch, config, batchLabel);
    for (const [id, verdict] of batchVerdicts) {
      verdictById.set(id, verdict);
    }
  }

  logBiorxivGate(`finished all batches · ${summarizeVerdicts(verdictById)}`);
  return verdictById;
}
