import { LIFE_SCIENCE_ROUTING_EXCLUSION_REASON } from "../constants.js";
import type { LifeScienceRoutingMethod, LifeScienceRoutingVerdict } from "../types.js";
import {
  matchRoutingKeywordFallback,
  type RoutingKeywordsConfig,
} from "./keywordFallbackMatcher.js";
import type {
  BroadScienceMergeResult,
  ExcludedPaper,
  LifeScienceRoutingStats,
} from "./types.js";
import { getSourceScope, passesScopeDefault } from "./sourceScope.js";

type RoutablePaper = {
  id: string;
  sourceId: string;
  title?: string;
  lifeScienceRouting?: {
    verdict: LifeScienceRoutingVerdict;
    method: LifeScienceRoutingMethod;
  };
};

export function emptyBroadScienceMergeResult<P>(): BroadScienceMergeResult<P> {
  return {
    included: [],
    excluded: [],
    llmYes: 0,
    llmNotSure: 0,
    llmNo: 0,
    keywordFallbackYes: 0,
    keywordFallbackNo: 0,
  };
}

export function emptyRoutingStats(total: number): LifeScienceRoutingStats {
  return {
    total,
    passedByScope: 0,
    llmClassified: 0,
    llmYes: 0,
    llmNotSure: 0,
    llmNo: 0,
    keywordFallbackClassified: 0,
    keywordFallbackYes: 0,
    keywordFallbackNo: 0,
    included: total,
    excluded: 0,
  };
}

export function routingResultWhenDisabled<P>(
  papers: P[],
): import("./types.js").LifeScienceRoutingResult<P> {
  return {
    enabled: false,
    included: papers,
    excluded: [],
    stats: emptyRoutingStats(papers.length),
  };
}

export function splitPapersByRoutingScope<P extends { sourceId: string }>(
  papers: P[],
  scopeBySourceId: ReadonlyMap<string, import("../types.js").SourceScope>,
): { lifeScienceOnly: P[]; broadScience: P[] } {
  const lifeScienceOnly: P[] = [];
  const broadScience: P[] = [];

  for (const paper of papers) {
    const scope = getSourceScope(scopeBySourceId, paper.sourceId);
    if (passesScopeDefault(scope)) {
      lifeScienceOnly.push(paper);
    } else {
      broadScience.push(paper);
    }
  }

  return { lifeScienceOnly, broadScience };
}

export function applyScopeDefaultRouting<P extends RoutablePaper>(papers: P[]) {
  return papers.map((paper) => ({
    ...paper,
    lifeScienceRouting: { verdict: "yes" as const, method: "scope-default" as const },
  }));
}

export function mergeBroadScienceRoutingResults<P extends RoutablePaper>(
  broadScience: P[],
  verdictById: ReadonlyMap<string, LifeScienceRoutingVerdict>,
): BroadScienceMergeResult<P> {
  const included: P[] = [];
  const excluded: ExcludedPaper<P>[] = [];
  let llmYes = 0;
  let llmNotSure = 0;
  let llmNo = 0;

  for (const paper of broadScience) {
    const verdict = verdictById.get(paper.id);
    if (!verdict) {
      throw new Error(`Missing routing verdict for ${paper.id}`);
    }

    if (verdict === "no") {
      llmNo += 1;
      excluded.push({
        paper,
        reason: LIFE_SCIENCE_ROUTING_EXCLUSION_REASON,
        verdict: "no",
        method: "llm",
      });
      continue;
    }

    if (verdict === "yes") llmYes += 1;
    if (verdict === "not_sure") llmNotSure += 1;

    included.push({
      ...paper,
      lifeScienceRouting: { verdict, method: "llm" },
    });
  }

  return {
    included,
    excluded,
    llmYes,
    llmNotSure,
    llmNo,
    keywordFallbackYes: 0,
    keywordFallbackNo: 0,
  };
}

export function mergeBroadScienceKeywordFallbackResults<
  P extends RoutablePaper & { title: string },
>(broadScience: P[], config: RoutingKeywordsConfig): BroadScienceMergeResult<P> {
  const included: P[] = [];
  const excluded: ExcludedPaper<P>[] = [];
  let keywordFallbackYes = 0;
  let keywordFallbackNo = 0;

  for (const paper of broadScience) {
    const match = matchRoutingKeywordFallback(paper.title, config);

    if (match.verdict === "no") {
      keywordFallbackNo += 1;
      excluded.push({
        paper,
        reason: LIFE_SCIENCE_ROUTING_EXCLUSION_REASON,
        verdict: "no",
        method: "routing-keyword-fallback",
      });
      continue;
    }

    keywordFallbackYes += 1;
    included.push({
      ...paper,
      lifeScienceRouting: {
        verdict: "yes",
        method: "routing-keyword-fallback",
      },
    });
  }

  return {
    included,
    excluded,
    llmYes: 0,
    llmNotSure: 0,
    llmNo: 0,
    keywordFallbackYes,
    keywordFallbackNo,
  };
}

export function combineBroadScienceMergeResults<P>(
  left: BroadScienceMergeResult<P>,
  right: BroadScienceMergeResult<P>,
): BroadScienceMergeResult<P> {
  return {
    included: [...left.included, ...right.included],
    excluded: [...left.excluded, ...right.excluded],
    llmYes: left.llmYes + right.llmYes,
    llmNotSure: left.llmNotSure + right.llmNotSure,
    llmNo: left.llmNo + right.llmNo,
    keywordFallbackYes: left.keywordFallbackYes + right.keywordFallbackYes,
    keywordFallbackNo: left.keywordFallbackNo + right.keywordFallbackNo,
  };
}

export function buildRoutingStats(options: {
  total: number;
  passedByScope: number;
  llmClassified: number;
  llmYes: number;
  llmNotSure: number;
  llmNo: number;
  keywordFallbackClassified: number;
  keywordFallbackYes: number;
  keywordFallbackNo: number;
  included: number;
  excluded: number;
}): LifeScienceRoutingStats {
  return options;
}

export function assembleRoutingResult<P extends RoutablePaper>(options: {
  scopeDefaultIncluded: P[];
  broadScienceMerge: BroadScienceMergeResult<P>;
  total: number;
}): import("./types.js").LifeScienceRoutingResult<P> {
  const { scopeDefaultIncluded, broadScienceMerge, total } = options;
  const included = [...scopeDefaultIncluded, ...broadScienceMerge.included];

  return {
    enabled: true,
    included,
    excluded: broadScienceMerge.excluded,
    stats: buildRoutingStats({
      total,
      passedByScope: scopeDefaultIncluded.length,
      llmClassified:
        broadScienceMerge.llmYes + broadScienceMerge.llmNotSure + broadScienceMerge.llmNo,
      llmYes: broadScienceMerge.llmYes,
      llmNotSure: broadScienceMerge.llmNotSure,
      llmNo: broadScienceMerge.llmNo,
      keywordFallbackClassified:
        broadScienceMerge.keywordFallbackYes + broadScienceMerge.keywordFallbackNo,
      keywordFallbackYes: broadScienceMerge.keywordFallbackYes,
      keywordFallbackNo: broadScienceMerge.keywordFallbackNo,
      included: included.length,
      excluded: broadScienceMerge.excluded.length,
    }),
  };
}
