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
  /** When set, only these paper ids may be added to degradedPaperIds. */
  degradeOnlyIds?: Set<string>;
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

/**
 * 缺 verdict 時組一次 focused retry batch（PR #11）。
 * 單一缺漏時帶半批 context，讓模型較不易再跳過同一篇。
 */
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

/**
 * 將論文標成 degraded，交由上層 keyword fallback（PR #19）。
 * degradeOnlyIds：missing-retry 時不可把 context 篇誤標 degraded（PR #11 / #19）。
 */
function markPapersDegraded(
  degradedPaperIds: Set<string> | undefined,
  ids: string[],
  batchLabel: string,
  reason: string,
  degradeOnlyIds?: Set<string>,
): void {
  if (!degradedPaperIds || ids.length === 0) return;
  const targetIds = degradeOnlyIds ? ids.filter((id) => degradeOnlyIds.has(id)) : ids;
  if (targetIds.length === 0) return;
  logRouting(
    `${batchLabel}: degraded ${targetIds.length} paper(s) (${reason}): ${targetIds.join(", ")}`,
  );
  for (const id of targetIds) {
    degradedPaperIds.add(id);
  }
}

/**
 * 無法取得可靠 verdict 時的保守路徑：標 degraded（走 keyword）或直接 fallback `no`。
 * 寧可漏收，也不要因單篇缺漏中斷整日 digest（PR #11 / #12）。
 */
function applyFallbackNo(
  verdictById: Map<string, LifeScienceRoutingVerdict>,
  ids: string[],
  batchLabel: string,
  options?: { reason?: string; degradedPaperIds?: Set<string>; degradeOnlyIds?: Set<string> },
): void {
  if (ids.length === 0) return;
  if (options?.degradedPaperIds) {
    markPapersDegraded(
      options.degradedPaperIds,
      ids,
      batchLabel,
      options.reason ?? "missing verdict",
      options.degradeOnlyIds,
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
  degradeOnlyIds?: Set<string>,
): Map<string, LifeScienceRoutingVerdict> {
  const paperIds = degradeOnlyIds
    ? items.filter((item) => degradeOnlyIds.has(item.id)).map((item) => item.id)
    : items.map((item) => item.id);
  markPapersDegraded(degradedPaperIds, paperIds, batchLabel, reason, degradeOnlyIds);
  return new Map();
}

/**
 * Broad-science 單批分類的恢復策略（由內而外）：
 * 1) 缺 verdict → focused missing-retry，只合併原本缺的 id（PR #11）
 * 2) missing-retry 請求失敗 → 對缺漏篇 fallback，不中斷（PR #12）
 * 3) timeout / 連線失敗 / 壞 JSON / token length → 對半分批再試（PR #9 / #15）
 * 4) 單篇仍失敗 → 標 degraded 交 keyword fallback（PR #18 / #19）
 */
async function classifyBatch(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
  options: ClassifyBatchOptions = {},
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  const { allowMissingVerdictRetry = true, degradedPaperIds, degradeOnlyIds } = options;

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
      applyFallbackNo(verdictById, parsed.missingIds, batchLabel, {
        degradedPaperIds,
        degradeOnlyIds,
      });
      logRouting(`${batchLabel}: parsed (${parsed.usageLine}) · ${summarizeVerdicts(verdictById)}`);
      return verdictById;
    }

    const retryItems = buildMissingVerdictRetryBatch(items, parsed.missingIds);
    logRouting(
      `${batchLabel}: missing-retry ${retryItems.length} paper(s) (from ${parsed.missingIds.length} missing)`,
    );

    // 只允許原本 missing 的 id 被標 degraded / 覆寫，避免半批 context 覆蓋第一輪結果。PR #11
    const originallyMissing = new Set(parsed.missingIds);
    let retryVerdicts: Map<string, LifeScienceRoutingVerdict>;
    try {
      retryVerdicts = await classifyBatch(retryItems, config, `${batchLabel} missing-retry`, {
        allowMissingVerdictRetry: false,
        degradedPaperIds,
        degradeOnlyIds: originallyMissing,
      });
    } catch (retryError) {
      // missing-retry 自身 timeout/網路錯誤：對缺漏篇 fallback，而非 abort（PR #12）
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      logRouting(`${batchLabel}: missing-retry failed (${message}); applying fallback for missing verdicts`);
      retryVerdicts = new Map();
    }

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
      // 大 batch timeout（如 40 篇）時對半拆，避免整晚 cron 卡死。PR #15
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
        degradeOnlyIds,
      );
    }

    if (!degradedPaperIds) {
      throw error;
    }

    // JSON / 其他不可恢復錯誤：degrade 交 keyword，不再 throw 殺管線。PR #18
    return degradeBatchForKeywordFallback(items, batchLabel, message, degradedPaperIds, degradeOnlyIds);
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
