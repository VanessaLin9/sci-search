import type { Paper, SourceScope } from "../types.js";
import { loadRoutingKeywordsConfig } from "../config.js";
import { classifyBroadSciencePapers } from "./classifyBroadScience.js";
import type { Clock } from "./clock.js";
import { mergeBroadScienceWithKeywordGateFallback } from "./broadScienceGateFallback.js";
import { getRoutingLlmConfig, maskApiKey } from "./config.js";
import {
  applyScopeDefaultRouting,
  assembleRoutingResult,
  combineBroadScienceMergeResults,
  emptyBroadScienceMergeResult,
  mergeBroadScienceRoutingResults,
  routingResultWhenDisabled,
  splitPapersByRoutingScope,
} from "../domain/life-science/routing/route.js";
import { isLifeScienceRoutingEnabled } from "../domain/life-science/routing/config.js";
import { logRouting } from "./routingLog.js";
import { toBroadScienceRoutingInput } from "./toRoutingInput.js";
import type { LifeScienceRoutingResult } from "./types.js";
import type { BroadScienceMergeResult } from "../domain/life-science/routing/types.js";

/**
 * Phase 2a：依 source scope 分流。
 * - life-science-only：預設納入，不打 LLM
 * - broad-science：LLM 判定；失敗則 keyword fallback（PR #18 / #19），絕不因 gate 掛掉中斷 daily
 */
export async function routeLifeSciencePapers(options: {
  papers: Paper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  /** Injectable clock for routing-stage budget / backoff tests. */
  clock?: Clock;
  routingBudgetMs?: number;
  jitterMs?: () => number;
}): Promise<LifeScienceRoutingResult> {
  const { papers, scopeBySourceId } = options;
  const enabled = isLifeScienceRoutingEnabled();

  if (!enabled) {
    return routingResultWhenDisabled(papers);
  }

  const { lifeScienceOnly, broadScience } = splitPapersByRoutingScope(papers, scopeBySourceId);
  const scopeDefaultIncluded = applyScopeDefaultRouting(lifeScienceOnly);

  logRouting(
    `split: ${lifeScienceOnly.length} life-science-only (skip LLM), ${broadScience.length} broad-science (LLM)`,
  );

  if (broadScience.length === 0) {
    logRouting("no broad-science papers; skipping LLM");
    return assembleRoutingResult({
      scopeDefaultIncluded,
      broadScienceMerge: emptyBroadScienceMergeResult(),
      total: papers.length,
    });
  }

  // 延遲載入：僅在有 broad-science 且 routing 開啟時才讀 routing-keywords.json。PR #19
  const keywordConfig = loadRoutingKeywordsConfig();

  try {
    const llmConfig = getRoutingLlmConfig();
    logRouting(
      `endpoint ${llmConfig.baseUrl} · model ${llmConfig.model} · key ${maskApiKey(llmConfig.apiKey)}`,
    );

    const llmInputs = broadScience.map(toBroadScienceRoutingInput);
    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(llmInputs, {
      clock: options.clock,
      budgetMs: options.routingBudgetMs,
      jitterMs: options.jitterMs,
    });

    // 成功 LLM 與 degraded 論文分開 merge：只有 degrade 才走 keyword，避免污染 llm* 統計。PR #19
    const degradedSet = new Set(degradedPaperIds);
    const llmPapers = broadScience.filter((paper) => !degradedSet.has(paper.id));
    const degradedPapers = broadScience.filter((paper) => degradedSet.has(paper.id));

    const llmMerge: BroadScienceMergeResult<Paper> =
      llmPapers.length > 0
        ? mergeBroadScienceRoutingResults(llmPapers, verdictById)
        : emptyBroadScienceMergeResult();

    const keywordMerge: BroadScienceMergeResult<Paper> =
      degradedPapers.length > 0
        ? mergeBroadScienceWithKeywordGateFallback(
            degradedPapers,
            "LLM gate degraded",
            keywordConfig,
          )
        : emptyBroadScienceMergeResult();

    return assembleRoutingResult({
      scopeDefaultIncluded,
      broadScienceMerge: combineBroadScienceMergeResults(llmMerge, keywordMerge),
      total: papers.length,
    });
  } catch (error) {
    // Gate 級失敗（缺 key、整批不可恢復等）：broad-science 全改 keyword fallback；life-science-only 仍保留。PR #18
    const message = error instanceof Error ? error.message : String(error);
    const broadScienceMerge: BroadScienceMergeResult<Paper> =
      mergeBroadScienceWithKeywordGateFallback(broadScience, message, keywordConfig);

    return assembleRoutingResult({
      scopeDefaultIncluded,
      broadScienceMerge,
      total: papers.length,
    });
  }
}
