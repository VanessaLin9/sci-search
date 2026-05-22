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

export const DEFAULT_RSS_SOURCE_IDS = [
  "nature",
  "nature-methods",
  "cell",
  "plos-biology",
  "pnas",
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

function classifyPaper(paper: Paper, keywords: KeywordsConfig): Paper {
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
  keywords: KeywordsConfig,
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
  const onReportDate = filterPapersByDate(deduped, reportDate);
  const { papers: enrichedOnReportDate, enrichedCount } = await enrichPapers(onReportDate);
  const classified = enrichedOnReportDate.map((paper) => classifyPaper(paper, keywords));

  return {
    papers: classified,
    normalized,
    stats: {
      sourceId: source.id,
      feedTitle: feed.title ?? source.name,
      rssItemCount: feed.items.length,
      normalizedCount: normalized.length,
      dedupedCount: deduped.length,
      onReportDateCount: onReportDate.length,
      enrichedCount,
      sectionCounts: countPapersBySection(classified),
    },
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

  return {
    reportDate: options.reportDate,
    papers,
    sourceResults,
  };
}
