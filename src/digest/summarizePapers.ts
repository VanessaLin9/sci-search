/**
 * Phase 2b：featured 逐篇 summarize（titleZh / summaryZh / topicTags）。
 *
 * 雙模型備援（featured only；PR #30；跨 provider：PR #34）：
 * - Primary：`DIGEST_LLM_MODEL` + primary key／baseUrl（timeout=`summarizeTimeoutMs`）
 * - Fallback：獨立 endpoint（`DIGEST_LLM_FALLBACK_MODEL` + `FALLBACK_API_KEY` + baseUrl，例如 Gemini）；
 *   只打 primary 最終失敗篇（timeout=`summarizeFallbackTimeoutMs`）
 * - Shared stage budget：`summarizeStageBudgetMs`（primary + fallback 共用）
 * - 429：尊重 Retry-After／reset hint，最多一次 budget-aware primary retry；仍失敗才 fallback
 * - 529／其他 5xx／timeout／network／empty／malformed／id mismatch：不做同模型無差別 retry，直接 fallback
 * - Fallback 前檢查剩餘 budget；不足則 budget skip，該篇保留英文卡
 *
 * SDK `summarizeMaxRetries` 應為 0；retry／wait／fallback 由本層決定（避免 SDK 再撞同一個 overloaded worker）。
 * LLM HTTP 走 `callDigestChatCompletion`（gate=`digest-summarize`）。
 */
import { z } from "zod";
import type { Clock } from "../routing/clock.js";
import { systemClock } from "../routing/clock.js";
import {
  classifyRoutingFailure,
  type ClassifiedRoutingFailure,
} from "../routing/classifyRoutingFailure.js";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { createRoutingBudget, MIN_USEFUL_REQUEST_MS, type RoutingBudget } from "../routing/routingBudget.js";
import {
  canAffordWaitAndRequest,
  planRateLimitWait,
} from "../routing/routingRetryPolicy.js";
import { callDigestChatCompletion } from "./callDigestChat.js";
import {
  getDigestLlmConfig,
  maskApiKey,
  withDigestFallbackEndpoint,
  type DigestLlmConfig,
} from "./config.js";
import { extractDigestMessageContent } from "./extractDigestContent.js";
import { logDigest } from "./digestLog.js";
import { runWithConcurrency } from "./runWithConcurrency.js";
import {
  buildDigestSummarizeCompletionParams,
  estimateSummarizeCompletionTokens,
} from "./summarizePrompt.js";
import { toDigestSummarizeInput } from "./toSummarizeInput.js";
import type { DigestSummarizeStats } from "./types.js";
import type { ClassifiedPaper, SourceScope } from "../types.js";

const summarizeResponseSchema = z.object({
  id: z.string(),
  title_zh: z.string().min(1),
  summary_zh: z.string().min(1),
  topic_tags: z.array(z.string()).min(1).max(8),
});

export type PaperSummarizeFields = {
  titleZh: string;
  summaryZh: string;
  topicTags: string[];
};

export type SummarizeModelRole = "primary" | "fallback";

type SummarizeOneSuccess = {
  ok: true;
  id: string;
  fields: PaperSummarizeFields;
  role: SummarizeModelRole;
  model: string;
  durationMs: number;
};

type SummarizeOneFailure = {
  ok: false;
  id: string;
  role: SummarizeModelRole;
  model: string;
  durationMs: number;
  failure: ClassifiedRoutingFailure;
  budgetSkipped?: boolean;
};

type SummarizeOneResult = SummarizeOneSuccess | SummarizeOneFailure;

function summarizeLabel(options: {
  index: number;
  total: number;
  paper: ClassifiedPaper;
  role: SummarizeModelRole;
  attempt?: "429-retry";
}): string {
  const idHint = options.paper.doi ?? options.paper.id;
  const attempt = options.attempt ? ` ${options.attempt}` : "";
  return `summarize ${options.index + 1}/${options.total} ${options.role}${attempt} (${idHint})`;
}

function emptyStats(): DigestSummarizeStats {
  return {
    requested: 0,
    llmSummarized: 0,
    primarySucceeded: 0,
    fallbackSucceeded: 0,
    failed: 0,
  };
}

async function attemptSummarize(options: {
  paper: ClassifiedPaper;
  index: number;
  total: number;
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  /** Already role-specific endpoint（primary 或 withDigestFallbackEndpoint）。 */
  config: DigestLlmConfig;
  role: SummarizeModelRole;
  /** Role cap before stage-budget clip（primary vs fallback timeout）. */
  configuredTimeoutMs: number;
  budget: RoutingBudget;
  attempt?: "429-retry";
  clock: Clock;
}): Promise<SummarizeOneResult> {
  const {
    paper,
    index,
    total,
    scopeBySourceId,
    config,
    role,
    configuredTimeoutMs,
    budget,
    attempt,
    clock,
  } = options;
  const model = config.model;
  const label = summarizeLabel({ index, total, paper, role, attempt });
  const input = toDigestSummarizeInput(paper, scopeBySourceId);
  const startedAt = clock.now();
  const initialTimeoutMs = budget.requestTimeoutMs(configuredTimeoutMs);

  try {
    const completion = await callDigestChatCompletion(
      config,
      (maxTokens, useJsonResponseFormat) =>
        buildDigestSummarizeCompletionParams(input, config, useJsonResponseFormat, maxTokens),
      {
        label,
        gate: "digest-summarize",
        estimatedCompletionTokens: estimateSummarizeCompletionTokens(),
        completionFloor: 2048,
        timeoutMs: initialTimeoutMs,
        // json bare-retry 前重算 remaining budget，避免第二發沿用過期 timeout（PR #34）。
        resolveRequestTimeoutMs: () => budget.requestTimeoutMs(configuredTimeoutMs),
        // Queue wait 對齊 shared scheduler wall clock；budget 只提供 remaining 時長（PR #35）。
        resolveDeadlineAtMs: () => Date.now() + Math.max(0, budget.remainingMs()),
        maxRetries: config.summarizeMaxRetries,
      },
    );

    const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
    const usage = completion.usage;
    const usageHint = usage
      ? `, tokens ${usage.completion_tokens ?? "?"} completion`
      : "";
    const { content, usedReasoningFallback } = extractDigestMessageContent(
      completion.choices[0]?.message,
    );
    if (usedReasoningFallback) {
      logDigest(`${label}: warning: JSON taken from reasoning_content`);
    }
    if (!content?.trim()) {
      throw new Error("empty output");
    }

    const parsed = summarizeResponseSchema.parse(parseJsonFromLlmContent(content));
    if (parsed.id !== paper.id) {
      throw new Error(`id mismatch (expected ${paper.id}, got ${parsed.id})`);
    }

    const durationMs = clock.now() - startedAt;
    logDigest(
      `${label}: ok · model=${model} role=${role} durationMs=${durationMs} ` +
        `(${parsed.topic_tags.length} tags, finish_reason=${finishReason}${usageHint})`,
    );
    return {
      ok: true,
      id: paper.id,
      fields: {
        titleZh: parsed.title_zh.trim(),
        summaryZh: parsed.summary_zh.trim(),
        topicTags: parsed.topic_tags.map((tag) => tag.trim()).filter(Boolean),
      },
      role,
      model,
      durationMs,
    };
  } catch (error) {
    const durationMs = clock.now() - startedAt;
    const failure = classifyRoutingFailure(error);
    logDigest(
      `${label}: failed · model=${model} role=${role} durationMs=${durationMs} ` +
        `kind=${failure.kind}` +
        (failure.status != null ? ` status=${failure.status}` : "") +
        ` (${failure.message})`,
    );
    return {
      ok: false,
      id: paper.id,
      role,
      model,
      durationMs,
      failure,
    };
  }
}

async function summarizePrimaryPaper(options: {
  paper: ClassifiedPaper;
  index: number;
  total: number;
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  config: DigestLlmConfig;
  budget: RoutingBudget;
  clock: Clock;
  jitterMs: () => number;
}): Promise<SummarizeOneResult> {
  const { paper, index, total, scopeBySourceId, config, budget, clock, jitterMs } = options;
  const model = config.model;

  const timeoutMs = budget.requestTimeoutMs(config.summarizeTimeoutMs);
  if (timeoutMs < MIN_USEFUL_REQUEST_MS) {
    const label = summarizeLabel({ index, total, paper, role: "primary" });
    logDigest(
      `${label}: skipped · model=${model} role=primary reason=budget_exhausted ` +
        `remainingMs=${budget.remainingMs()}`,
    );
    return {
      ok: false,
      id: paper.id,
      role: "primary",
      model,
      durationMs: 0,
      failure: { kind: "unknown", message: "summarize budget exhausted before primary request" },
      budgetSkipped: true,
    };
  }

  const first = await attemptSummarize({
    paper,
    index,
    total,
    scopeBySourceId,
    config,
    role: "primary",
    configuredTimeoutMs: config.summarizeTimeoutMs,
    budget,
    clock,
  });
  if (first.ok) return first;

  // 529 是 worker overload：同模型立即重試幾乎無效，應把時間留給不同 endpoint（PR #30）。
  if (first.failure.kind !== "rate_limit") {
    return first;
  }

  // 429 才做一次 budget-aware primary wait/retry；仍失敗才進 fallback endpoint。
  const plan = planRateLimitWait({
    headers: first.failure.headers,
    nowMs: clock.now(),
    jitterMs,
  });
  const remainingBeforeWait = budget.remainingMs();
  logDigest(
    `${summarizeLabel({ index, total, paper, role: "primary" })}: 429 · hint=${plan.source} ` +
      `plannedWait=${plan.waitMs}ms remainingMs=${remainingBeforeWait}`,
  );

  if (!canAffordWaitAndRequest(remainingBeforeWait, plan.waitMs)) {
    logDigest(
      `${summarizeLabel({ index, total, paper, role: "primary" })}: 429 retry skipped · reason=budget ` +
        `waitMs=${plan.waitMs} remainingMs=${remainingBeforeWait}`,
    );
    return first;
  }

  await clock.sleep(plan.waitMs);

  const retryTimeoutMs = budget.requestTimeoutMs(config.summarizeTimeoutMs);
  if (retryTimeoutMs < MIN_USEFUL_REQUEST_MS) {
    logDigest(
      `${summarizeLabel({ index, total, paper, role: "primary", attempt: "429-retry" })}: skipped · ` +
        `reason=budget_exhausted remainingMs=${budget.remainingMs()}`,
    );
    return first;
  }

  return attemptSummarize({
    paper,
    index,
    total,
    scopeBySourceId,
    config,
    role: "primary",
    configuredTimeoutMs: config.summarizeTimeoutMs,
    budget,
    attempt: "429-retry",
    clock,
  });
}

async function summarizeFallbackPaper(options: {
  paper: ClassifiedPaper;
  index: number;
  total: number;
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  /** Full fallback endpoint config from withDigestFallbackEndpoint. */
  config: DigestLlmConfig;
  budget: RoutingBudget;
  clock: Clock;
}): Promise<SummarizeOneResult> {
  const { paper, index, total, scopeBySourceId, config, budget, clock } = options;
  const model = config.model;
  const label = summarizeLabel({ index, total, paper, role: "fallback" });

  // Shared budget 含 primary 等待；剩餘不足時寧可英文卡，也不拖垮 daily cron（PR #30）。
  if (!budget.canStartRequest()) {
    logDigest(
      `${label}: skipped · model=${model} role=fallback reason=budget_exhausted ` +
        `remainingMs=${budget.remainingMs()}`,
    );
    return {
      ok: false,
      id: paper.id,
      role: "fallback",
      model,
      durationMs: 0,
      failure: { kind: "unknown", message: "summarize budget exhausted before fallback request" },
      budgetSkipped: true,
    };
  }

  const timeoutMs = budget.requestTimeoutMs(config.summarizeFallbackTimeoutMs);
  if (timeoutMs < MIN_USEFUL_REQUEST_MS) {
    logDigest(
      `${label}: skipped · model=${model} role=fallback reason=budget_exhausted ` +
        `remainingMs=${budget.remainingMs()}`,
    );
    return {
      ok: false,
      id: paper.id,
      role: "fallback",
      model,
      durationMs: 0,
      failure: { kind: "unknown", message: "summarize budget exhausted before fallback request" },
      budgetSkipped: true,
    };
  }

  return attemptSummarize({
    paper,
    index,
    total,
    scopeBySourceId,
    config,
    role: "fallback",
    configuredTimeoutMs: config.summarizeFallbackTimeoutMs,
    budget,
    clock,
  });
}

/** 對 `featured` 論文並行 summarize；primary 失敗篇再走 fallback（若有設定）。 */
export async function summarizeFeaturedPapers(options: {
  papers: ClassifiedPaper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  config?: DigestLlmConfig;
  clock?: Clock;
  jitterMs?: () => number;
}): Promise<{
  fieldsById: Map<string, PaperSummarizeFields>;
  stats: DigestSummarizeStats;
}> {
  const featured = options.papers.filter((paper) => paper.featured);
  const config = options.config ?? getDigestLlmConfig();
  const clock = options.clock ?? systemClock;
  const jitterMs = options.jitterMs ?? (() => Math.floor(Math.random() * 1_001));
  const fieldsById = new Map<string, PaperSummarizeFields>();

  if (featured.length === 0) {
    return { fieldsById, stats: emptyStats() };
  }

  const budget = createRoutingBudget(clock, config.summarizeStageBudgetMs);
  const fallbackConfig = withDigestFallbackEndpoint(config);

  logDigest(
    `summarize ${featured.length} featured paper(s) · primary=${config.model}` +
      (fallbackConfig
        ? ` fallback=${fallbackConfig.model} fallbackBase=${fallbackConfig.baseUrl}`
        : " fallback=off") +
      ` concurrency=${config.summarizeConcurrency}` +
      ` primaryTimeoutMs=${config.summarizeTimeoutMs}` +
      ` fallbackTimeoutMs=${config.summarizeFallbackTimeoutMs}` +
      ` stageBudgetMs=${config.summarizeStageBudgetMs}` +
      ` sdkRetries=${config.summarizeMaxRetries}`,
  );

  const primaryResults = await runWithConcurrency(
    featured,
    config.summarizeConcurrency,
    (paper, index) =>
      summarizePrimaryPaper({
        paper,
        index,
        total: featured.length,
        scopeBySourceId: options.scopeBySourceId,
        config,
        budget,
        clock,
        jitterMs,
      }),
  );

  let primarySucceeded = 0;
  let fallbackSucceeded = 0;
  let failed = 0;
  const failedPapers: Array<{ paper: ClassifiedPaper; index: number }> = [];

  for (let index = 0; index < primaryResults.length; index += 1) {
    const result = primaryResults[index];
    if (result.ok) {
      fieldsById.set(result.id, result.fields);
      primarySucceeded += 1;
    } else {
      failedPapers.push({ paper: featured[index], index });
    }
  }

  if (failedPapers.length > 0 && fallbackConfig) {
    logDigest(
      `summarize fallback for ${failedPapers.length} failed paper(s) · model=${fallbackConfig.model} ` +
        `base=${fallbackConfig.baseUrl} key=${maskApiKey(fallbackConfig.apiKey)} ` +
        `concurrency=${config.summarizeFallbackConcurrency} remainingMs=${budget.remainingMs()}`,
    );

    const fallbackResults = await runWithConcurrency(
      failedPapers,
      config.summarizeFallbackConcurrency,
      ({ paper, index }) =>
        summarizeFallbackPaper({
          paper,
          index,
          total: featured.length,
          scopeBySourceId: options.scopeBySourceId,
          config: fallbackConfig,
          budget,
          clock,
        }),
    );

    for (const result of fallbackResults) {
      if (result.ok) {
        fieldsById.set(result.id, result.fields);
        fallbackSucceeded += 1;
      } else {
        failed += 1;
      }
    }
  } else if (failedPapers.length > 0) {
    failed = failedPapers.length;
    logDigest(
      `summarize fallback off · ${failed} paper(s) keep English cards (set DIGEST_LLM_FALLBACK_MODEL)`,
    );
  }

  const llmSummarized = primarySucceeded + fallbackSucceeded;
  logDigest(
    `summarize done: ${llmSummarized} LLM ` +
      `(primary=${primarySucceeded}, fallback=${fallbackSucceeded}), ${failed} failed`,
  );

  return {
    fieldsById,
    stats: {
      requested: featured.length,
      llmSummarized,
      primarySucceeded,
      fallbackSucceeded,
      failed,
    },
  };
}
