import type { Paper, SourceScope } from "../types.js";
import { classifyBroadSciencePapers } from "./classifyBroadScience.js";
import { mergeBroadScienceWithGateFallback } from "./broadScienceGateFallback.js";
import { getRoutingLlmConfig, maskApiKey } from "./config.js";
import {
  applyScopeDefaultRouting,
  assembleRoutingResult,
  mergeBroadScienceRoutingResults,
  routingResultWhenDisabled,
  splitPapersByRoutingScope,
} from "../domain/life-science/routing/route.js";
import { isLifeScienceRoutingEnabled } from "../domain/life-science/routing/config.js";
import { logRouting } from "./routingLog.js";
import { toBroadScienceRoutingInput } from "./toRoutingInput.js";
import type { LifeScienceRoutingResult } from "./types.js";

export async function routeLifeSciencePapers(options: {
  papers: Paper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
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
      broadScienceMerge: {
        included: [],
        excluded: [],
        llmYes: 0,
        llmNotSure: 0,
        llmNo: 0,
      },
      total: papers.length,
    });
  }

  let broadScienceMerge: ReturnType<typeof mergeBroadScienceRoutingResults<Paper>>;

  try {
    const llmConfig = getRoutingLlmConfig();
    logRouting(
      `endpoint ${llmConfig.baseUrl} · model ${llmConfig.model} · key ${maskApiKey(llmConfig.apiKey)}`,
    );

    const llmInputs = broadScience.map(toBroadScienceRoutingInput);
    const verdictById = await classifyBroadSciencePapers(llmInputs);
    broadScienceMerge = mergeBroadScienceRoutingResults(broadScience, verdictById);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    broadScienceMerge = mergeBroadScienceWithGateFallback(broadScience, message);
  }

  return assembleRoutingResult({
    scopeDefaultIncluded,
    broadScienceMerge,
    total: papers.length,
  });
}
