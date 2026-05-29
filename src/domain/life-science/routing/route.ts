import { LIFE_SCIENCE_ROUTING_EXCLUSION_REASON } from "../constants.js";
import type { LifeScienceRoutingVerdict } from "../types.js";
import type {
  ExcludedPaper,
  LifeScienceRoutingResult,
  LifeScienceRoutingStats,
} from "./types.js";
import { getSourceScope, passesScopeDefault } from "./sourceScope.js";

type RoutablePaper = {
  id: string;
  sourceId: string;
  lifeScienceRouting?: {
    verdict: LifeScienceRoutingVerdict;
    method: "scope-default" | "llm";
  };
};

export function emptyRoutingStats(total: number): LifeScienceRoutingStats {
  return {
    total,
    passedByScope: 0,
    llmClassified: 0,
    llmYes: 0,
    llmNotSure: 0,
    llmNo: 0,
    included: total,
    excluded: 0,
  };
}

export function routingResultWhenDisabled<P>(
  papers: P[],
): LifeScienceRoutingResult<P> {
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
): {
  included: P[];
  excluded: ExcludedPaper<P>[];
  llmYes: number;
  llmNotSure: number;
  llmNo: number;
} {
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

  return { included, excluded, llmYes, llmNotSure, llmNo };
}

export function buildRoutingStats(options: {
  total: number;
  passedByScope: number;
  llmClassified: number;
  llmYes: number;
  llmNotSure: number;
  llmNo: number;
  included: number;
  excluded: number;
}): LifeScienceRoutingStats {
  return options;
}

export function assembleRoutingResult<P extends RoutablePaper>(options: {
  scopeDefaultIncluded: P[];
  broadScienceMerge: ReturnType<typeof mergeBroadScienceRoutingResults<P>>;
  total: number;
}): LifeScienceRoutingResult<P> {
  const { scopeDefaultIncluded, broadScienceMerge, total } = options;
  const included = [...scopeDefaultIncluded, ...broadScienceMerge.included];

  return {
    enabled: true,
    included,
    excluded: broadScienceMerge.excluded,
    stats: buildRoutingStats({
      total,
      passedByScope: scopeDefaultIncluded.length,
      llmClassified: broadScienceMerge.included.length + broadScienceMerge.excluded.length,
      llmYes: broadScienceMerge.llmYes,
      llmNotSure: broadScienceMerge.llmNotSure,
      llmNo: broadScienceMerge.llmNo,
      included: included.length,
      excluded: broadScienceMerge.excluded.length,
    }),
  };
}
