import type { Paper, SourceScope } from "../types.js";
import { classifyBroadSciencePapers } from "./classifyBroadScience.js";
import { isLifeScienceRoutingEnabled } from "./config.js";
import { getSourceScope } from "./sourceScope.js";
import { toBroadScienceRoutingInput } from "./toRoutingInput.js";
import type {
  ExcludedPaper,
  LifeScienceRoutingResult,
  LifeScienceRoutingStats,
} from "./types.js";

function emptyStats(total: number): LifeScienceRoutingStats {
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

export async function routeLifeSciencePapers(options: {
  papers: Paper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<LifeScienceRoutingResult> {
  const { papers, scopeBySourceId } = options;
  const enabled = isLifeScienceRoutingEnabled();

  if (!enabled) {
    return {
      enabled: false,
      included: papers,
      excluded: [],
      stats: emptyStats(papers.length),
    };
  }

  const lifeScienceOnly: Paper[] = [];
  const broadScience: Paper[] = [];

  for (const paper of papers) {
    const scope = getSourceScope(scopeBySourceId, paper.sourceId);
    if (scope === "life-science-only") {
      lifeScienceOnly.push(paper);
    } else {
      broadScience.push(paper);
    }
  }

  const scopeDefaultIncluded = lifeScienceOnly.map((paper) => ({
    ...paper,
    lifeScienceRouting: { verdict: "yes" as const, method: "scope-default" as const },
  }));

  const llmInputs = broadScience.map(toBroadScienceRoutingInput);
  const verdictById = await classifyBroadSciencePapers(llmInputs);

  const included: Paper[] = [...scopeDefaultIncluded];
  const excluded: ExcludedPaper[] = [];
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
        reason: "life-science-routing",
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

  const stats: LifeScienceRoutingStats = {
    total: papers.length,
    passedByScope: scopeDefaultIncluded.length,
    llmClassified: broadScience.length,
    llmYes,
    llmNotSure,
    llmNo,
    included: included.length,
    excluded: excluded.length,
  };

  return { enabled: true, included, excluded, stats };
}
