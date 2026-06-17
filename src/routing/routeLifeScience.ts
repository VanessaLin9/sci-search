import type { Paper, SourceScope } from "../types.js";
import { loadRoutingKeywordsConfig } from "../config.js";
import { classifyBroadSciencePapers } from "./classifyBroadScience.js";
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

export async function routeLifeSciencePapers(options: {
  papers: Paper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<LifeScienceRoutingResult> {
  const { papers, scopeBySourceId } = options;
  const enabled = isLifeScienceRoutingEnabled();
  const keywordConfig = loadRoutingKeywordsConfig();

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

  try {
    const llmConfig = getRoutingLlmConfig();
    logRouting(
      `endpoint ${llmConfig.baseUrl} · model ${llmConfig.model} · key ${maskApiKey(llmConfig.apiKey)}`,
    );

    const llmInputs = broadScience.map(toBroadScienceRoutingInput);
    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(llmInputs);

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
