import type { Paper } from "../types.js";
import type { BiorxivGateVerdict } from "./types.js";

export type BiorxivGateExcluded = {
  paper: Paper;
  verdict: BiorxivGateVerdict;
};

export type BiorxivGateFilterResult = {
  included: Paper[];
  excluded: BiorxivGateExcluded[];
  yes: number;
  no: number;
  notSure: number;
};

export function filterPapersByBiorxivGate(
  papers: Paper[],
  verdictById: ReadonlyMap<string, BiorxivGateVerdict>,
): BiorxivGateFilterResult {
  const included: Paper[] = [];
  const excluded: BiorxivGateExcluded[] = [];
  let yes = 0;
  let no = 0;
  let notSure = 0;

  for (const paper of papers) {
    const verdict = verdictById.get(paper.id);
    if (!verdict) {
      throw new Error(`Missing bioRxiv gate verdict for ${paper.id}`);
    }

    if (verdict === "yes") {
      yes += 1;
      included.push(paper);
      continue;
    }

    if (verdict === "no") no += 1;
    if (verdict === "not_sure") notSure += 1;
    excluded.push({ paper, verdict });
  }

  return { included, excluded, yes, no, notSure };
}
