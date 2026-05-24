import { fetchRssSource } from "./fetchRss.js";
import {
  classifyPaperSection,
  countPapersBySection,
  dedupePapers,
  filterPapersByDate,
  matchKeywords,
} from "./filterPapers.js";
import { enrichPapers } from "./enrichers/index.js";
import { normalizeRssItemToPaper } from "./normalize.js";
import type { Paper, PaperSection, Source } from "./types.js";

/** Active RSS sources, ordered by `config/sources.json` priority (see SKILL journal list). */
export const DEFAULT_RSS_SOURCE_IDS = [
  "cell",
  "nature",
  "science",
  "nature-methods",
  "nature-genetics",
  "nature-ecology-evolution",
  "nature-biotechnology",
  "nature-cell-biology",
  "nature-neuroscience",
  "nature-immunology",
  "nature-microbiology",
  "science-advances",
  "pnas",
  "plos-biology",
  "nature-communications",
] as const;

export type KeywordsConfig = {
  primary: string[];
  biology: string[];
};

export type SourcePipelineStats = {
  sourceId: string;
  feedTitle: string;
  rssItemCount: number;
  normalizedCount: number;
  dedupedCount: number;
  onReportDateCount: number;
  enrichedCount: number;
  excludedCount: number;
  sectionCounts: Record<PaperSection, number>;
};

export type SourceProcessResult = {
  papers: Paper[];
  normalized: Paper[];
  stats: SourcePipelineStats;
};

export type PipelineRunResult = {
  reportDate: string;
  papers: Paper[];
  sourceResults: SourceProcessResult[];
};

export function classifyPaper(paper: Paper, keywords: KeywordsConfig): Paper {
  const searchableText = [paper.title, paper.abstract].filter(Boolean).join(" ");
  const primaryMatches = matchKeywords(searchableText, keywords.primary);
  const biologyMatches = matchKeywords(searchableText, keywords.biology);

  return {
    ...paper,
    matchedKeywords: [...primaryMatches, ...biologyMatches],
    section: classifyPaperSection(primaryMatches, biologyMatches),
  };
}

export async function processRssSource(
  source: Source,
  _keywords: KeywordsConfig,
  reportDate: string,
): Promise<SourceProcessResult> {
  if (source.kind !== "rss") {
    throw new Error(`Source ${source.id} is not an RSS source`);
  }

  const feed = await fetchRssSource(source);
  const normalized = feed.items
    .map((item) => normalizeRssItemToPaper(item, source))
    .filter((paper): paper is Paper => paper !== null);
  const deduped = dedupePapers(normalized);
  const onReportDate = filterPapersByDate(deduped, reportDate).map((paper) => ({
    ...paper,
    matchedKeywords: [],
    section: "other" as const,
  }));

  return {
    papers: onReportDate,
    normalized,
    stats: {
      sourceId: source.id,
      feedTitle: feed.title ?? source.name,
      rssItemCount: feed.items.length,
      normalizedCount: normalized.length,
      dedupedCount: deduped.length,
      onReportDateCount: onReportDate.length,
      enrichedCount: 0,
      excludedCount: 0,
      sectionCounts: countPapersBySection(onReportDate),
    },
  };
}

/** Enrich then keyword/section tagging (after life-science routing). */
export async function enrichAndClassifyPapers(
  papers: Paper[],
  keywords: KeywordsConfig,
): Promise<{
  papers: Paper[];
  enrichedCount: number;
  enrichExcludedCount: number;
}> {
  const { papers: enriched, enrichedCount, excludedCount } = await enrichPapers(papers);
  const classified = enriched.map((paper) => classifyPaper(paper, keywords));
  return {
    papers: classified,
    enrichedCount,
    enrichExcludedCount: excludedCount,
  };
}

export async function runPipeline(options: {
  sources: Source[];
  keywords: KeywordsConfig;
  reportDate: string;
  rssSourceIds?: readonly string[];
}): Promise<PipelineRunResult> {
  const rssSourceIds = options.rssSourceIds ?? DEFAULT_RSS_SOURCE_IDS;
  const papers: Paper[] = [];
  const sourceResults: SourceProcessResult[] = [];

  for (const id of rssSourceIds) {
    const source = options.sources.find((candidate) => candidate.id === id);
    if (!source) {
      throw new Error(`Source ${id} not found`);
    }

    const result = await processRssSource(source, options.keywords, options.reportDate);
    papers.push(...result.papers);
    sourceResults.push(result);
  }

  const dedupedPapers = dedupePapers(papers);

  return {
    reportDate: options.reportDate,
    papers: dedupedPapers,
    sourceResults,
  };
}
