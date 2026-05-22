import { isDebugEnabled, logEnrichResult } from "../debug.js";
import type { Paper } from "../types.js";
import { enrichNatureMethodsPaper } from "./nature-methods.js";
import { enrichPnasPaper } from "./pnas.js";
import { enrichSciencePaper } from "./science.js";

export type PaperEnricher = (paper: Paper) => Promise<Paper>;

const PAPER_ENRICHERS: Record<string, PaperEnricher> = {
  "nature": enrichNatureMethodsPaper,
  "nature-methods": enrichNatureMethodsPaper,
  "nature-genetics": enrichNatureMethodsPaper,
  "nature-communications": enrichNatureMethodsPaper,
  "nature-ecology-evolution": enrichNatureMethodsPaper,
  "nature-biotechnology": enrichNatureMethodsPaper,
  "nature-cell-biology": enrichNatureMethodsPaper,
  "nature-neuroscience": enrichNatureMethodsPaper,
  "pnas": enrichPnasPaper,
  "science": enrichSciencePaper,
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

    let next = paper;
    try {
      next = await enricher(paper);
    } catch (error) {
      console.warn(`Enrich failed (${paper.sourceId}/${paper.id}):`, error);
    }
    if (next.abstract && !paper.abstract) {
      enrichedCount += 1;
    }
    if (isDebugEnabled()) {
      logEnrichResult(paper, next);
    }
    enriched.push(next);
  }

  return { papers: enriched, enrichedCount };
}
