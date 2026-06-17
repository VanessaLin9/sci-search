import { z } from "zod";
import { lifeScienceRoutingVerdictSchema } from "../domain/life-science/schemas.js";
import {
  isRoutingBatchRequestFailure,
  shouldRetrySplitLlmBatch,
} from "../llm/extractLlmJsonContent.js";
import type { LifeScienceRoutingVerdict } from "../types.js";
import { planRoutingBatches } from "./batchSizing.js";
import {
  callRoutingCompletion,
  extractRoutingMessageContent,
} from "./callRoutingCompletion.js";
import { getRoutingLlmConfig, maskApiKey, type RoutingLlmConfig } from "./config.js";
import { parseJsonFromLlmContent } from "./parseLlmJson.js";
import { logRouting } from "./routingLog.js";
import type { BroadScienceRoutingInput } from "./types.js";

const verdictSchema = lifeScienceRoutingVerdictSchema;

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
  degradedPaperIds?: Set<string>;
};

type ParsedBatchResult = {
  verdictById: Map<string, LifeScienceRoutingVerdict>;
  missingIds: string[];
  finishReason: string;
  usageLine: string;
  parsedResultCount: number;
};

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

/** Build the one retry batch for missing verdicts (exported for tests). */
export function buildMissingVerdictRetryBatch(
  items: BroadScienceRoutingInput[],
  missingIds: string[],
): BroadScienceRoutingInput[] {
  if (missingIds.length === 0) return [];
  if (missingIds.length > 1) {
    const missingSet = new Set(missingIds);
    return items.filter((item) => missingSet.has(item.id));
  }

  const missingId = missingIds[0]!;
  const mid = Math.ceil(items.length / 2);
  const firstHalf = items.slice(0, mid);
  if (firstHalf.some((item) => item.id === missingId)) {
    return firstHalf;
  }
  return items.slice(mid);
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
  logRouting(
    `${batchLabel}: missing ${options.missingIds.length}/${options.totalCount} verdict(s) ` +
      `(finish_reason=${options.finishReason}, ${options.usageLine}, parsed=${options.parsedResultCount}): ` +
      `${options.missingIds.join(", ")}`,
  );
}

function markPapersDegraded(
  degradedPaperIds: Set<string> | undefined,
  ids: string[],
  batchLabel: string,
  reason: string,
): void {
  if (!degradedPaperIds || ids.length === 0) return;
  logRouting(
    `${batchLabel}: degraded ${ids.length} paper(s) (${reason}): ${ids.join(", ")}`,
  );
  for (const id of ids) {
    degradedPaperIds.add(id);
  }
}

function applyFallbackNo(
  verdictById: Map<string, LifeScienceRoutingVerdict>,
  ids: string[],
  batchLabel: string,
  options?: { reason?: string; degradedPaperIds?: Set<string> },
): void {
  if (ids.length === 0) return;
  if (options?.degradedPaperIds) {
    markPapersDegraded(
      options.degradedPaperIds,
      ids,
      batchLabel,
      options.reason ?? "missing verdict",
    );
    return;
  }

  const line = options?.reason
    ? `${batchLabel}: fallback no for ${ids.length} paper(s) (${options.reason}): ${ids.join(", ")}`
    : `${batchLabel}: fallback no for ${ids.length} missing verdict(s): ${ids.join(", ")}`;
  logRouting(line);
  for (const id of ids) {
    verdictById.set(id, "no");
  }
}

function degradeBatchForKeywordFallback(
  items: BroadScienceRoutingInput[],
  batchLabel: string,
  reason: string,
  degradedPaperIds: Set<string>,
): Map<string, LifeScienceRoutingVerdict> {
  markPapersDegraded(
    degradedPaperIds,
    items.map((item) => item.id),
    batchLabel,
    reason,
  );
  return new Map();
}

async function classifyBatch(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
  options: ClassifyBatchOptions = {},
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  const { allowMissingVerdictRetry = true, degradedPaperIds } = options;

  try {
    const parsed = await classifyBatchOnce(items, config, batchLabel);

    if (parsed.missingIds.length === 0) {
      logRouting(`${batchLabel}: parsed (${parsed.usageLine}) · ${summarizeVerdicts(parsed.verdictById)}`);
      return parsed.verdictById;
    }

    logMissingVerdictDiagnostic(batchLabel, {
      missingIds: parsed.missingIds,
      totalCount: items.length,
      finishReason: parsed.finishReason,
      usageLine: parsed.usageLine,
      parsedResultCount: parsed.parsedResultCount,
    });

    const verdictById = new Map(parsed.verdictById);

    if (!allowMissingVerdictRetry) {
      applyFallbackNo(verdictById, parsed.missingIds, batchLabel, { degradedPaperIds });
      logRouting(`${batchLabel}: parsed (${parsed.usageLine}) · ${summarizeVerdicts(verdictById)}`);
      return verdictById;
    }

    const retryItems = buildMissingVerdictRetryBatch(items, parsed.missingIds);
    logRouting(
      `${batchLabel}: missing-retry ${retryItems.length} paper(s) (from ${parsed.missingIds.length} missing)`,
    );

    let retryVerdicts: Map<string, LifeScienceRoutingVerdict>;
    try {
      retryVerdicts = await classifyBatch(retryItems, config, `${batchLabel} missing-retry`, {
        allowMissingVerdictRetry: false,
        degradedPaperIds,
      });
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      logRouting(`${batchLabel}: missing-retry failed (${message}); applying fallback for missing verdicts`);
      retryVerdicts = new Map();
    }

    const originallyMissing = new Set(parsed.missingIds);
    for (const [id, verdict] of retryVerdicts) {
      if (originallyMissing.has(id)) {
        verdictById.set(id, verdict);
      }
    }

    const stillMissing = parsed.missingIds.filter((id) => !verdictById.has(id));
    if (stillMissing.length > 0) {
      applyFallbackNo(verdictById, stillMissing, batchLabel, { degradedPaperIds });
    }

    logRouting(`${batchLabel}: parsed (${parsed.usageLine}) · ${summarizeVerdicts(verdictById)}`);
    return verdictById;
  } catch (error) {
    const finishReason =
      error instanceof Error && "finishReason" in error
        ? String((error as Error & { finishReason: string }).finishReason)
        : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    const requestFailed = isRoutingBatchRequestFailure(error);
    const canSplit =
      items.length > 1 &&
      (shouldRetrySplitLlmBatch(error, finishReason) || requestFailed);

    if (canSplit) {
      const mid = Math.ceil(items.length / 2);
      const reason = requestFailed ? `request failed (${message})` : "recoverable error";
      logRouting(`${batchLabel}: ${reason}; split retry ${items.length} → ${mid} + ${items.length - mid}`);
      const first = await classifyBatch(items.slice(0, mid), config, `${batchLabel}a`, options);
      const second = await classifyBatch(items.slice(mid), config, `${batchLabel}b`, options);
      return new Map([...first, ...second]);
    }

    if (requestFailed) {
      if (!degradedPaperIds) {
        throw error;
      }
      return degradeBatchForKeywordFallback(
        items,
        batchLabel,
        `request failure (${message})`,
        degradedPaperIds,
      );
    }

    if (!degradedPaperIds) {
      throw error;
    }

    return degradeBatchForKeywordFallback(items, batchLabel, message, degradedPaperIds);
  }
}

async function classifyBatchOnce(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
): Promise<ParsedBatchResult> {
  const { completion } = await callRoutingCompletion(items, config, { label: batchLabel });

  const usage = completion.usage;
  const usageLine = usage
    ? `prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`
    : "usage n/a";

  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";

  let content: string;
  let usedReasoningFallback: boolean;
  try {
    ({ content, usedReasoningFallback } = extractRoutingMessageContent(completion.choices[0]?.message));
  } catch (extractError) {
    if (items.length > 1 && shouldRetrySplitLlmBatch(extractError, finishReason)) {
      throw attachFinishReason(extractError, finishReason);
    }
    throw extractError;
  }
  if (usedReasoningFallback) {
    logRouting(
      `${batchLabel}: warning: JSON taken from reasoning_content`,
    );
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
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

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

export type BroadScienceClassificationResult = {
  verdictById: Map<string, LifeScienceRoutingVerdict>;
  degradedPaperIds: string[];
};

export async function classifyBroadSciencePapers(
  items: BroadScienceRoutingInput[],
): Promise<BroadScienceClassificationResult> {
  if (items.length === 0) {
    return { verdictById: new Map(), degradedPaperIds: [] };
  }

  const degradedPaperIds = new Set<string>();

  const config = getRoutingLlmConfig();
  const { batches, estimatedInputTokens, estimatedCompletionTokens } = planRoutingBatches(
    items,
    {
      maxInputTokens: config.maxInputTokens,
      maxCompletionTokens: config.maxTokens,
      maxPapersPerBatch: config.maxPapersPerBatch,
    },
  );
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

  const batchSummary = batches
    .map(
      (batch, index) =>
        `${batch.length} papers (~${estimatedInputTokens[index]} tok in, ~${estimatedCompletionTokens[index]} tok out)`,
    )
    .join(", ");

  logRouting(
    `LLM config: model=${config.model} base=${config.baseUrl} key=${maskApiKey(config.apiKey)} ` +
      `maxInput=${config.maxInputTokens} maxCompletion=${config.maxTokens} maxPapers=${config.maxPapersPerBatch} thinking=${config.disableThinking ? "off" : "on"}`,
  );
  logRouting(
    `classifying ${items.length} broad-science paper(s) in ${batches.length} batch(es): ${batchSummary}`,
  );

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel = `batch ${index + 1}/${batches.length}`;
    const batchVerdicts = await classifyBatch(batch, config, batchLabel, { degradedPaperIds });
    for (const [id, verdict] of batchVerdicts) {
      verdictById.set(id, verdict);
    }
  }

  logRouting(`finished all batches · ${summarizeVerdicts(verdictById)}`);
  return { verdictById, degradedPaperIds: [...degradedPaperIds] };
}
