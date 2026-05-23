import { isDebugEnabled, logEnrichResult } from "../debug.js";
import { isNatureRssTeaserAbstract } from "../normalizers/rss/nature-encoded.js";
import type { Paper } from "../types.js";
import { enrichNatureMainPaper } from "./nature-main.js";
import { enrichNatureMethodsPaper } from "./nature-methods.js";
import { enrichPnasPaper } from "./pnas.js";
import { enrichScienceAdvancesPaper } from "./science-advances.js";
import { enrichSciencePaper } from "./science.js";

export type PaperEnricher = (paper: Paper) => Promise<Paper | null>;

const PAPER_ENRICHERS: Record<string, PaperEnricher> = {
  "nature": enrichNatureMainPaper,
  "nature-methods": enrichNatureMethodsPaper,
  "nature-genetics": enrichNatureMethodsPaper,
  "nature-communications": enrichNatureMethodsPaper,
  "nature-ecology-evolution": enrichNatureMethodsPaper,
  "nature-biotechnology": enrichNatureMethodsPaper,
  "nature-cell-biology": enrichNatureMethodsPaper,
  "nature-neuroscience": enrichNatureMethodsPaper,
  "nature-immunology": enrichNatureMethodsPaper,
  "nature-microbiology": enrichNatureMethodsPaper,
  "pnas": enrichPnasPaper,
  "science": enrichSciencePaper,
  "science-advances": enrichScienceAdvancesPaper,
};

export type EnrichPapersResult = {
  papers: Paper[];
  enrichedCount: number;
  excludedCount: number;
};

function hasUsableAbstract(paper: Paper): boolean {
  const abstract = paper.abstract?.trim();
  if (!abstract) return false;
  return !isNatureRssTeaserAbstract(abstract);
}

/** Caller should pass papers already filtered to the report date (see pipeline). */
export async function enrichPapers(papers: Paper[]): Promise<EnrichPapersResult> {
  let enrichedCount = 0;
  let excludedCount = 0;
  const enriched: Paper[] = [];

  for (const paper of papers) {
    const enricher =
      paper.sourceId in PAPER_ENRICHERS ? PAPER_ENRICHERS[paper.sourceId] : undefined;
    const needsAbstract = Boolean(enricher) && !hasUsableAbstract(paper);

    if (!enricher) {
      enriched.push(paper);
      continue;
    }

    if (!needsAbstract && paper.sourceId !== "nature") {
      enriched.push(paper);
      continue;
    }

    let next: Paper | null = paper;
    try {
      next = await enricher(paper);
    } catch (error) {
      console.warn(`Enrich failed (${paper.sourceId}/${paper.id}):`, error);
    }

    if (!next) {
      excludedCount += 1;
      if (isDebugEnabled()) {
        console.warn(`Excluded (${paper.sourceId}): ${paper.title}`);
      }
      continue;
    }

    if (next.abstract?.trim() && !hasUsableAbstract(paper)) {
      enrichedCount += 1;
    }
    if (isDebugEnabled()) {
      logEnrichResult(paper, next);
    }
    enriched.push(next);
  }

  return { papers: enriched, enrichedCount, excludedCount };
}
