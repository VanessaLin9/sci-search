import { fetchRssSource } from "./fetchRss.js";
import {
  classifyPaperSection,
  dedupePapers,
  filterPapersByDate,
  matchKeywords,
} from "./filterPapers.js";
import { enrichPapers, type EnrichPapersResult } from "./enrichers/index.js";
import { normalizeRssItemToPaper } from "./normalize.js";
import { runDigestPhase } from "./digest/runDigestPhase.js";
import type { DigestPhaseResult } from "./digest/types.js";
import { routeLifeSciencePapers } from "./routing/routeLifeScience.js";
import type { LifeScienceRoutingResult } from "./routing/types.js";
import type {
  ClassifiedPaper,
  Paper,
  Source,
  SourceScope,
} from "./types.js";

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
};

export type SourceProcessResult = {
  papers: Paper[];
  normalized: Paper[];
  stats: SourcePipelineStats;
};

export type RunPipelineOptions = {
  sources: Source[];
  keywords: KeywordsConfig;
  reportDate: string;
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  rssSourceIds?: readonly string[];
};

export type PipelineRunResult = {
  reportDate: string;
  papers: ClassifiedPaper[];
  sourceResults: SourceProcessResult[];
  routing: LifeScienceRoutingResult;
  enrich: EnrichPapersResult;
  digest: DigestPhaseResult;
};

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineRunResult> {
  const sourceResults = await collectPapersFromSources(options);
  const deduped = dedupePapers(sourceResults.flatMap((result) => result.papers));
  const routing = await routeLifeSciencePapers({
    papers: deduped,
    scopeBySourceId: options.scopeBySourceId,
  });
  const enrich = await enrichPapers(routing.included);
  const classified = classifyPapers(enrich.papers, options.keywords);
  const digest = await runDigestPhase({
    papers: classified,
    sources: options.sources,
    scopeBySourceId: options.scopeBySourceId,
  });

  return {
    reportDate: options.reportDate,
    papers: digest.papers,
    sourceResults,
    routing,
    enrich,
    digest,
  };
}

export function classifyPaper(paper: Paper, keywords: KeywordsConfig): ClassifiedPaper {
  const searchableText = [paper.title, paper.abstract].filter(Boolean).join(" ");
  const primaryMatches = matchKeywords(searchableText, keywords.primary);
  const biologyMatches = matchKeywords(searchableText, keywords.biology);

  return {
    ...paper,
    matchedKeywords: [...primaryMatches, ...biologyMatches],
    section: classifyPaperSection(primaryMatches, biologyMatches),
  };
}

export function classifyPapers(papers: Paper[], keywords: KeywordsConfig): ClassifiedPaper[] {
  return papers.map((paper) => classifyPaper(paper, keywords));
}

async function collectPapersFromSources(options: RunPipelineOptions): Promise<SourceProcessResult[]> {
  const rssSourceIds = options.rssSourceIds ?? DEFAULT_RSS_SOURCE_IDS;
  const results: SourceProcessResult[] = [];

  for (const id of rssSourceIds) {
    const source = options.sources.find((candidate) => candidate.id === id);
    if (!source) {
      throw new Error(`Source ${id} not found`);
    }
    results.push(await processRssSource(source, options.reportDate));
  }

  return results;
}

async function fetchAndParseRss(source: Source) {
  return fetchRssSource(source);
}

function normalizeFeedItems(
  items: Awaited<ReturnType<typeof fetchAndParseRss>>["items"],
  source: Source,
): Paper[] {
  return items
    .map((item) => normalizeRssItemToPaper(item, source))
    .filter((paper): paper is Paper => paper !== null);
}

async function processRssSource(source: Source, reportDate: string): Promise<SourceProcessResult> {
  if (source.kind !== "rss") {
    throw new Error(`Source ${source.id} is not an RSS source`);
  }

  try {
    const feed = await fetchAndParseRss(source);
    const normalized = normalizeFeedItems(feed.items, source);
    const deduped = dedupePapers(normalized);
    const onReportDate = filterPapersByDate(deduped, reportDate);

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
      },
    };
  } catch (error) {
    console.warn(
      `RSS skipped for ${source.id} (${source.url}):`,
      error instanceof Error ? error.message : error,
    );
    return {
      papers: [],
      normalized: [],
      stats: {
        sourceId: source.id,
        feedTitle: source.name,
        rssItemCount: 0,
        normalizedCount: 0,
        dedupedCount: 0,
        onReportDateCount: 0,
      },
    };
  }
}
