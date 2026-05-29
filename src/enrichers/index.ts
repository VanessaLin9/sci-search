import { isDebugEnabled, logEnrichResult } from "../debug.js";
import {
  PAPER_ENRICHER_REGISTRY,
  type PaperEnricherKind,
} from "../domain/life-science/feeds/registries.js";
import { isNatureRssTeaserAbstract } from "../normalizers/rss/nature-encoded.js";
import type { Paper } from "../types.js";
import { enrichNatureMainPaper } from "./nature-main.js";
import { enrichNatureMethodsPaper } from "./nature-methods.js";
import { enrichPnasPaper } from "./pnas.js";
import { enrichScienceAdvancesPaper } from "./science-advances.js";
import { enrichSciencePaper } from "./science.js";

export type PaperEnricher = (paper: Paper) => Promise<Paper | null>;

const PAPER_ENRICHER_IMPLEMENTATIONS: Record<PaperEnricherKind, PaperEnricher> = {
  "nature-main": enrichNatureMainPaper,
  "nature-methods": enrichNatureMethodsPaper,
  pnas: enrichPnasPaper,
  science: enrichSciencePaper,
  "science-advances": enrichScienceAdvancesPaper,
};

const PAPER_ENRICHERS = Object.fromEntries(
  Object.entries(PAPER_ENRICHER_REGISTRY).map(([sourceId, enricherKind]) => [
    sourceId,
    PAPER_ENRICHER_IMPLEMENTATIONS[enricherKind],
  ]),
) as Record<keyof typeof PAPER_ENRICHER_REGISTRY, PaperEnricher>;

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

/** Caller should pass papers after report-date filter and life-science routing (see pipeline). */
export async function enrichPapers(papers: Paper[]): Promise<EnrichPapersResult> {
  let enrichedCount = 0;
  let excludedCount = 0;
  const enriched: Paper[] = [];

  for (const paper of papers) {
    const enricher =
      paper.sourceId in PAPER_ENRICHERS
        ? PAPER_ENRICHERS[paper.sourceId as keyof typeof PAPER_ENRICHERS]
        : undefined;
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

export { PAPER_ENRICHER_REGISTRY };
