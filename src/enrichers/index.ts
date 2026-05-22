import type { Paper } from "../types.js";
import { enrichNatureMethodsPaper } from "./nature-methods.js";

export type PaperEnricher = (paper: Paper) => Promise<Paper>;

const PAPER_ENRICHERS: Record<string, PaperEnricher> = {
  "nature-methods": enrichNatureMethodsPaper,
};

export type EnrichPapersResult = {
  papers: Paper[];
  enrichedCount: number;
};

/** Caller should pass papers already filtered to the report date (see pipeline). */
export async function enrichPapers(papers: Paper[]): Promise<EnrichPapersResult> {
  let enrichedCount = 0;
  const enriched: Paper[] = [];

  for (const paper of papers) {
    const enricher = PAPER_ENRICHERS[paper.sourceId];
    if (!enricher || paper.abstract?.trim()) {
      enriched.push(paper);
      continue;
    }

    const next = await enricher(paper);
    if (next.abstract && !paper.abstract) {
      enrichedCount += 1;
    }
    enriched.push(next);
  }

  return { papers: enriched, enrichedCount };
}
