import type { Paper } from "../types.js";
import { classifyBiorxivGatePapers } from "./classifyBiorxivGate.js";
import { filterPapersByBiorxivGate } from "./filterByGate.js";
import { logBiorxivGate } from "./gateLog.js";
import { toBiorxivGateInput } from "./toGateInput.js";

export type BiorxivFineScreenStats = {
  candidates: number;
  passed: number;
  yes: number;
  no: number;
  notSure: number;
};

export type BiorxivGateResult = {
  papers: Paper[];
  usedFallback: boolean;
  fallbackReason?: string;
  fineScreen?: BiorxivFineScreenStats;
};

function logExcludedPapers(
  excluded: ReturnType<typeof filterPapersByBiorxivGate>["excluded"],
): void {
  for (const entry of excluded) {
    logBiorxivGate(
      `excluded ${entry.paper.id} · ${entry.verdict} · ${entry.paper.title}`,
    );
  }
}

export async function applyBiorxivGate(papers: Paper[]): Promise<BiorxivGateResult> {
  if (papers.length === 0) {
    return { papers, usedFallback: false };
  }

  logBiorxivGate(`classifying ${papers.length} keyword-matched candidate(s)`);

  try {
    const inputs = papers.map(toBiorxivGateInput);
    const verdictById = await classifyBiorxivGatePapers(inputs);
    const filtered = filterPapersByBiorxivGate(papers, verdictById);

    logBiorxivGate(
      `result: ${filtered.included.length}/${papers.length} passed · ${summarizeCounts(filtered)}`,
    );
    logExcludedPapers(filtered.excluded);

    return {
      papers: filtered.included,
      usedFallback: false,
      fineScreen: {
        candidates: papers.length,
        passed: filtered.included.length,
        yes: filtered.yes,
        no: filtered.no,
        notSure: filtered.notSure,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logBiorxivGate(
      `failed; falling back to keyword-only results: ${message} (${papers.length} paper(s))`,
    );
    return { papers, usedFallback: true, fallbackReason: message };
  }
}

function summarizeCounts(filtered: ReturnType<typeof filterPapersByBiorxivGate>): string {
  return `yes ${filtered.yes}, not_sure ${filtered.notSure}, no ${filtered.no}`;
}
