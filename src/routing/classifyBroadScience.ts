import { z } from "zod";
import { lifeScienceRoutingVerdictSchema } from "../domain/life-science/schemas.js";
import { shouldRetrySplitLlmBatch } from "../llm/extractLlmJsonContent.js";
import { LlmRequestSchedulerError } from "../llm/llmRequestScheduler.js";
import type { LifeScienceRoutingVerdict } from "../types.js";
import { planRoutingBatches } from "./batchSizing.js";
import {
  callRoutingCompletion,
  extractRoutingMessageContent,
} from "./callRoutingCompletion.js";
import { systemClock, type Clock } from "./clock.js";
import {
  classifyRoutingFailure,
  isFatalProviderFailure,
  isSplitRecoverableFailure,
  isTransportFailure,
  type ClassifiedRoutingFailure,
} from "./classifyRoutingFailure.js";
import { getRoutingLlmConfig, maskApiKey, type RoutingLlmConfig } from "./config.js";
import { isJsonResponseFormatCompatibilityFailure } from "./isJsonResponseFormatCompatibilityFailure.js";
import { parseJsonFromLlmContent } from "./parseLlmJson.js";
import { MIN_USEFUL_REQUEST_MS } from "./routingBudget.js";
import {
  createRoutingExecutionContext,
  formatRoutingStageSummary,
  type RoutingExecutionContext,
  type RoutingStageDiagnostics,
  type RoutingStopReason,
} from "./routingExecutionContext.js";
import { logRouting } from "./routingLog.js";
import {
  canAffordWaitAndRequest,
  MAX_SPLIT_DEPTH,
  planRateLimitWait,
  SERVER_ERROR_BACKOFF_MS,
} from "./routingRetryPolicy.js";
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
  splitDepth?: number;
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

function recordFailureDiagnostics(
  ctx: RoutingExecutionContext,
  failure: ClassifiedRoutingFailure,
): void {
  switch (failure.kind) {
    case "timeout":
      ctx.noteTimeout();
      break;
    case "network":
      ctx.noteNetworkError();
      break;
    case "rate_limit":
      ctx.noteRateLimit();
      break;
    case "server_error":
      ctx.noteServerError();
      break;
    case "length":
    case "parse":
      ctx.noteParseFailure();
      break;
    default:
      break;
  }
}

function stopReasonForFailure(failure: ClassifiedRoutingFailure): RoutingStopReason | null {
  switch (failure.kind) {
    case "timeout":
      return "timeout";
    case "network":
      return "network";
    case "rate_limit":
      return "persistent_rate_limit";
    case "server_error":
      return "persistent_5xx";
    case "auth":
      return "auth";
    case "config":
      return "config";
    default:
      return null;
  }
}

async function sleepWithBudget(
  ctx: RoutingExecutionContext,
  waitMs: number,
  batchLabel: string,
  detail: string,
): Promise<boolean> {
  if (!canAffordWaitAndRequest(ctx.budget.remainingMs(), waitMs)) {
    logRouting(
      `${batchLabel}: skip wait (${detail}); remaining=${ctx.budget.remainingMs()}ms ` +
        `wait=${waitMs}ms insufficient for wait+request`,
    );
    return false;
  }
  logRouting(`${batchLabel}: waiting ${waitMs}ms (${detail}) · remaining=${ctx.budget.remainingMs()}ms`);
  await ctx.clock.sleep(waitMs);
  return true;
}

/**
 * App 擁有的單次 attempt 重試政策（PR #28）：
 * - 429：先等 hint／預設 backoff，最多再試一次；budget 不夠則不 sleep
 * - 5xx：短 backoff 後最多一次
 * - timeout／network／auth：不 retry，開 breaker
 */
async function classifyBatchOnceWithRetryPolicy(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
  ctx: RoutingExecutionContext,
): Promise<ParsedBatchResult> {
  let rateLimitRetried = false;
  let serverErrorRetried = false;

  for (;;) {
    if (!ctx.canCallProvider()) {
      throw new Error(`${batchLabel}: routing breaker open (${ctx.stopReason})`);
    }
    if (!ctx.budget.canStartRequest()) {
      ctx.openBreaker("budget_exhausted");
      throw new Error(`${batchLabel}: routing budget exhausted`);
    }

    const requestTimeoutMs = ctx.budget.requestTimeoutMs(config.timeoutMs);
    if (requestTimeoutMs < MIN_USEFUL_REQUEST_MS) {
      ctx.openBreaker("budget_exhausted");
      throw new Error(`${batchLabel}: routing budget exhausted`);
    }

    logRouting(
      `${batchLabel}: attempt · batch=${items.length} timeout=${requestTimeoutMs}ms ` +
        `remaining=${ctx.budget.remainingMs()}ms stop=${ctx.stopReason ?? "none"}`,
    );

    try {
      return await classifyBatchOnce(items, config, batchLabel, ctx, requestTimeoutMs);
    } catch (error) {
      const finishReason =
        error instanceof Error && "finishReason" in error
          ? String((error as Error & { finishReason: string }).finishReason)
          : "unknown";
      // Queue deadline 必須開 budget_exhausted，否則後續 batch 還會繼續進 queue（PR #35）。
      if (error instanceof LlmRequestSchedulerError && error.kind === "deadline") {
        ctx.openBreaker("budget_exhausted");
        throw error;
      }

      const failure = classifyRoutingFailure(error, finishReason);
      recordFailureDiagnostics(ctx, failure);

      if (failure.kind === "rate_limit" && !rateLimitRetried) {
        rateLimitRetried = true;
        const plan = planRateLimitWait({
          headers: failure.headers,
          nowMs: ctx.clock.now(),
          jitterMs: ctx.jitterMs,
        });
        logRouting(
          `${batchLabel}: 429 rate limit · hint=${plan.source} plannedWait=${plan.waitMs}ms ` +
            `remaining=${ctx.budget.remainingMs()}ms`,
        );
        const waited = await sleepWithBudget(
          ctx,
          plan.waitMs,
          batchLabel,
          `429 ${plan.source}`,
        );
        if (!waited) {
          // Spec: budget 不足以等待+retry 時直接 fallback，原因記為 persistent rate limit。
          ctx.openBreaker("persistent_rate_limit");
          throw error;
        }
        continue;
      }

      if (failure.kind === "server_error" && !serverErrorRetried) {
        serverErrorRetried = true;
        logRouting(
          `${batchLabel}: 5xx · plannedWait=${SERVER_ERROR_BACKOFF_MS}ms remaining=${ctx.budget.remainingMs()}ms`,
        );
        const waited = await sleepWithBudget(
          ctx,
          SERVER_ERROR_BACKOFF_MS,
          batchLabel,
          "5xx backoff",
        );
        if (!waited) {
          ctx.openBreaker("persistent_5xx");
          throw error;
        }
        continue;
      }

      if (failure.kind === "rate_limit") {
        ctx.openBreaker("persistent_rate_limit");
      } else if (failure.kind === "server_error") {
        ctx.openBreaker("persistent_5xx");
      } else if (isTransportFailure(failure.kind) || isFatalProviderFailure(failure.kind)) {
        const reason = stopReasonForFailure(failure);
        if (reason) ctx.openBreaker(reason);
      }

      throw error;
    }
  }
}

/**
 * Broad-science 單批分類的恢復策略（由內而外）：
 * 1) 缺 verdict → focused missing-retry，只合併原本缺的 id（PR #11）
 * 2) missing-retry 請求失敗 → 對缺漏篇 fallback，不中斷（PR #12）
 * 3) length / 壞 JSON → 有限 depth 對半分批再試（不再因 timeout 拆批）
 * 4) timeout / network / persistent 429/5xx / auth → 開 breaker，不再打 provider
 * 5) 單篇仍失敗 → 標 degraded 交 keyword fallback（PR #18 / #19）
 *
 * Why no transport split（PR #28）：7/31 daily 在 timeout 後走 40→20→…→1 疊 SDK retry，
 * routing 近一小時；timeout 應立即 fail-open 到 keyword，保留已成功 verdict。
 */
async function classifyBatch(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
  ctx: RoutingExecutionContext,
  options: ClassifyBatchOptions = {},
): Promise<Map<string, LifeScienceRoutingVerdict>> {
  const {
    allowMissingVerdictRetry = true,
    degradedPaperIds,
    degradeOnlyIds,
    splitDepth = 0,
  } = options;

  if (!degradedPaperIds) {
    throw new Error("classifyBatch requires degradedPaperIds");
  }

  if (!ctx.canCallProvider() || !ctx.budget.canStartRequest()) {
    if (!ctx.canCallProvider()) {
      // already stopped
    } else {
      ctx.openBreaker("budget_exhausted");
    }
    return degradeBatchForKeywordFallback(
      items,
      batchLabel,
      `breaker/budget (${ctx.stopReason ?? "budget_exhausted"})`,
      degradedPaperIds,
      degradeOnlyIds,
    );
  }

  try {
    const parsed = await classifyBatchOnceWithRetryPolicy(items, config, batchLabel, ctx);

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

    if (!ctx.canCallProvider() || !ctx.budget.canStartRequest()) {
      applyFallbackNo(verdictById, parsed.missingIds, batchLabel, {
        degradedPaperIds,
        reason: `missing-retry skipped (${ctx.stopReason ?? "budget_exhausted"})`,
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
      retryVerdicts = await classifyBatch(retryItems, config, `${batchLabel} missing-retry`, ctx, {
        allowMissingVerdictRetry: false,
        degradedPaperIds,
        degradeOnlyIds: originallyMissing,
        splitDepth,
      });
    } catch (retryError) {
      // missing-retry 自身失敗：對缺漏篇 fallback，而非 abort（PR #12）
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
    const failure = classifyRoutingFailure(error, finishReason);

    // Transport / fatal / persistent rate-limit already opened the breaker in the retry layer.
    if (
      isTransportFailure(failure.kind) ||
      isFatalProviderFailure(failure.kind) ||
      failure.kind === "rate_limit" ||
      failure.kind === "server_error" ||
      message.includes("routing budget exhausted") ||
      message.includes("routing breaker open") ||
      (error instanceof LlmRequestSchedulerError && error.kind === "deadline")
    ) {
      return degradeBatchForKeywordFallback(
        items,
        batchLabel,
        `${failure.kind} (${message})`,
        degradedPaperIds,
        degradeOnlyIds,
      );
    }

    const canSplit =
      items.length > 1 &&
      splitDepth < MAX_SPLIT_DEPTH &&
      isSplitRecoverableFailure(failure.kind) &&
      shouldRetrySplitLlmBatch(error, finishReason) &&
      ctx.canCallProvider() &&
      ctx.budget.canStartRequest();

    if (canSplit) {
      const mid = Math.ceil(items.length / 2);
      logRouting(
        `${batchLabel}: recoverable ${failure.kind}; split retry ${items.length} → ${mid} + ${items.length - mid} ` +
          `(depth ${splitDepth + 1}/${MAX_SPLIT_DEPTH})`,
      );
      const nextOptions: ClassifyBatchOptions = {
        ...options,
        splitDepth: splitDepth + 1,
      };
      const first = await classifyBatch(
        items.slice(0, mid),
        config,
        `${batchLabel}a`,
        ctx,
        nextOptions,
      );
      const second = await classifyBatch(
        items.slice(mid),
        config,
        `${batchLabel}b`,
        ctx,
        nextOptions,
      );
      return new Map([...first, ...second]);
    }

    // JSON / 其他不可恢復錯誤：degrade 交 keyword，不再 throw 殺管線。PR #18
    // parse failures on a leaf do not mark the provider unhealthy.
    return degradeBatchForKeywordFallback(items, batchLabel, message, degradedPaperIds, degradeOnlyIds);
  }
}

async function classifyBatchOnce(
  items: BroadScienceRoutingInput[],
  config: RoutingLlmConfig,
  batchLabel: string,
  ctx: RoutingExecutionContext,
  requestTimeoutMs: number,
): Promise<ParsedBatchResult> {
  const { completion } = await callRoutingCompletion(items, config, {
    label: batchLabel,
    requestTimeoutMs,
    resolveRequestTimeoutMs: () => {
      const timeoutMs = ctx.budget.requestTimeoutMs(config.timeoutMs);
      if (timeoutMs < MIN_USEFUL_REQUEST_MS) {
        ctx.openBreaker("budget_exhausted");
        throw new Error(`${batchLabel}: routing budget exhausted`);
      }
      return timeoutMs;
    },
    // Queue wait 也受 stage budget 約束。用 wall clock 對齊 shared scheduler（budget 只貢獻 remaining 時長）（PR #35）。
    resolveDeadlineAtMs: () => Date.now() + Math.max(0, ctx.budget.remainingMs()),
    // json_object 裸重試也要受 breaker／budget 約束；非相容性失敗交回 policy（PR #28）
    shouldRetryWithoutJsonResponseFormat: (error) => {
      if (!isJsonResponseFormatCompatibilityFailure(error) || !ctx.canCallProvider()) {
        return false;
      }
      // 相容性失敗但 budget 已不足：標 budget_exhausted，避免 stage summary 出現 stop=none（PR #28）
      if (!ctx.budget.canStartRequest()) {
        ctx.openBreaker("budget_exhausted");
        return false;
      }
      return true;
    },
    onRequestAttempt: () => ctx.noteRequest(),
  });

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
    logRouting(`${batchLabel}: warning: JSON taken from reasoning_content`);
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
  diagnostics: RoutingStageDiagnostics;
};

export type ClassifyBroadScienceOptions = {
  clock?: Clock;
  budgetMs?: number;
  jitterMs?: () => number;
  /** Test helper: override resolved routing LLM config (e.g. force preferJsonResponseFormat). */
  configOverrides?: Partial<RoutingLlmConfig>;
};

function resolveConfigFailureStopReason(error: unknown): RoutingStopReason {
  const failure = classifyRoutingFailure(error);
  if (failure.kind === "auth") return "auth";
  return "config";
}

export async function classifyBroadSciencePapers(
  items: BroadScienceRoutingInput[],
  options: ClassifyBroadScienceOptions = {},
): Promise<BroadScienceClassificationResult> {
  const clock = options.clock ?? systemClock;
  const ctx = createRoutingExecutionContext({
    clock,
    budgetMs: options.budgetMs,
    jitterMs: options.jitterMs,
  });

  if (items.length === 0) {
    return {
      verdictById: new Map(),
      degradedPaperIds: [],
      diagnostics: ctx.snapshot(0, 0),
    };
  }

  const degradedPaperIds = new Set<string>();

  let config: RoutingLlmConfig;
  try {
    config = { ...getRoutingLlmConfig(), ...options.configOverrides };
  } catch (error) {
    // 缺 key／model 也走同一套 typed diagnostics，避免外層 catch 吞掉 stop reason（PR #28）
    const message = error instanceof Error ? error.message : String(error);
    const stopReason = resolveConfigFailureStopReason(error);
    ctx.openBreaker(stopReason);
    for (const item of items) {
      degradedPaperIds.add(item.id);
    }
    const diagnostics = ctx.snapshot(0, degradedPaperIds.size);
    logRouting(`config failure before LLM (${stopReason}): ${message}`);
    logRouting(formatRoutingStageSummary(diagnostics));
    return {
      verdictById: new Map(),
      degradedPaperIds: [...degradedPaperIds],
      diagnostics,
    };
  }

  const { batches, estimatedInputTokens, estimatedCompletionTokens } = planRoutingBatches(items, {
    maxInputTokens: config.maxInputTokens,
    maxCompletionTokens: config.maxTokens,
    maxPapersPerBatch: config.maxPapersPerBatch,
  });
  const verdictById = new Map<string, LifeScienceRoutingVerdict>();

  const batchSummary = batches
    .map(
      (batch, index) =>
        `${batch.length} papers (~${estimatedInputTokens[index]} tok in, ~${estimatedCompletionTokens[index]} tok out)`,
    )
    .join(", ");

  logRouting(
    `LLM config: model=${config.model} base=${config.baseUrl} key=${maskApiKey(config.apiKey)} ` +
      `maxInput=${config.maxInputTokens} maxCompletion=${config.maxTokens} maxPapers=${config.maxPapersPerBatch} ` +
      `thinking=${config.disableThinking ? "off" : "on"} sdkMaxRetries=${config.maxRetries} ` +
      `preferJson=${config.preferJsonResponseFormat} stageBudget=${ctx.budget.totalMs}ms`,
  );
  logRouting(
    `classifying ${items.length} broad-science paper(s) in ${batches.length} batch(es): ${batchSummary}`,
  );

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel = `batch ${index + 1}/${batches.length}`;

    if (!ctx.canCallProvider() || !ctx.budget.canStartRequest()) {
      if (ctx.canCallProvider() && !ctx.budget.canStartRequest()) {
        ctx.openBreaker("budget_exhausted");
      }
      logRouting(
        `${batchLabel}: skipped (${ctx.stopReason ?? "budget_exhausted"}); degrading ${batch.length} paper(s)`,
      );
      degradeBatchForKeywordFallback(
        batch,
        batchLabel,
        `skipped (${ctx.stopReason ?? "budget_exhausted"})`,
        degradedPaperIds,
      );
      continue;
    }

    const batchVerdicts = await classifyBatch(batch, config, batchLabel, ctx, { degradedPaperIds });
    for (const [id, verdict] of batchVerdicts) {
      verdictById.set(id, verdict);
    }
  }

  // Any paper never classified and never degraded still needs keyword fallback.
  for (const item of items) {
    if (!verdictById.has(item.id) && !degradedPaperIds.has(item.id)) {
      degradedPaperIds.add(item.id);
    }
  }

  const diagnostics = ctx.snapshot(verdictById.size, degradedPaperIds.size);
  logRouting(`finished all batches · ${summarizeVerdicts(verdictById)}`);
  logRouting(formatRoutingStageSummary(diagnostics));

  return { verdictById, degradedPaperIds: [...degradedPaperIds], diagnostics };
}
