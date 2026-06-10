import type { Item } from "rss-parser";
import { loadBiorxivFileConfig } from "./config.js";
import { fetchBiorxivRecords } from "./fetchBiorxiv.js";
import { fetchRssSource } from "./fetchRss.js";
import { dedupePapers, filterPapersByDate } from "./filterPapers.js";
import { enrichPapers, type EnrichPapersResult } from "./enrichers/index.js";
import { normalizeRssItemToPaper } from "./normalize.js";
import { applyBiorxivGate } from "./biorxiv-gate/applyBiorxivGate.js";
import { normalizeBiorxivRecordToPaper, filterBiorxivPapersByPrimaryKeywords } from "./normalizers/biorxiv.js";
import { runDigestPhase } from "./digest/runDigestPhase.js";
import type { DigestPhaseResult } from "./digest/types.js";
import { routeLifeSciencePapers } from "./routing/routeLifeScience.js";
import type { LifeScienceRoutingResult } from "./routing/types.js";
import {
  classifyPaperKeywords,
  classifyPapersWithKeywords,
  DEFAULT_BIORXIV_SOURCE_IDS,
  DEFAULT_RSS_SOURCE_IDS,
  type LifeScienceKeywordsConfig,
} from "./domain/life-science/index.js";
import type { ClassifiedPaper, Paper, Source, SourceScope } from "./types.js";

export { DEFAULT_BIORXIV_SOURCE_IDS, DEFAULT_RSS_SOURCE_IDS };

export type KeywordsConfig = LifeScienceKeywordsConfig;

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
  biorxivSourceIds?: readonly string[];
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
  return classifyPaperKeywords(paper, keywords);
}

export function classifyPapers(papers: Paper[], keywords: KeywordsConfig): ClassifiedPaper[] {
  return classifyPapersWithKeywords(papers, keywords);
}

async function collectPapersFromSources(options: RunPipelineOptions): Promise<SourceProcessResult[]> {
  const rssSourceIds = options.rssSourceIds ?? DEFAULT_RSS_SOURCE_IDS;
  const biorxivSourceIds = options.biorxivSourceIds ?? DEFAULT_BIORXIV_SOURCE_IDS;
  const results: SourceProcessResult[] = [];

  for (const id of rssSourceIds) {
    const source = options.sources.find((candidate) => candidate.id === id);
    if (!source) {
      throw new Error(`Source ${id} not found`);
    }
    results.push(await processRssSource(source, options.reportDate));
  }

  if (biorxivSourceIds.length > 0) {
    const biorxivConfig = loadBiorxivFileConfig();
    for (const id of biorxivSourceIds) {
      const source = options.sources.find((candidate) => candidate.id === id);
      if (!source) {
        throw new Error(`Source ${id} not found`);
      }
      results.push(
        await processBiorxivSource(
          source,
          options.reportDate,
          biorxivConfig.categories,
          options.keywords,
        ),
      );
    }
  }

  return results;
}

async function fetchAndParseRss(source: Source) {
  return fetchRssSource(source);
}

function normalizeFeedItems(items: Item[], source: Source): Paper[] {
  return items
    .map((item) => normalizeRssItemToPaper(item, source))
    .filter((paper): paper is Paper => paper !== null);
}

function applyPerSourceFilters(
  normalized: Paper[],
  reportDate: string,
): { deduped: Paper[]; onReportDate: Paper[] } {
  const deduped = dedupePapers(normalized);
  const onReportDate = filterPapersByDate(deduped, reportDate);
  return { deduped, onReportDate };
}

async function processBiorxivSource(
  source: Source,
  reportDate: string,
  categories: readonly string[],
  keywords: KeywordsConfig,
): Promise<SourceProcessResult> {
  if (source.kind !== "biorxiv-api") {
    throw new Error(`Source ${source.id} is not a bioRxiv API source`);
  }

  try {
    const { records, fetchedCount } = await fetchBiorxivRecords({
      baseUrl: source.url,
      reportDate,
      categories,
    });
    const normalized = records
      .map((record) => normalizeBiorxivRecordToPaper(record, source))
      .filter((paper): paper is Paper => paper !== null);
    const keywordMatched = filterBiorxivPapersByPrimaryKeywords(normalized, keywords);
    const gateCandidates = dedupePapers(keywordMatched);
    const gateResult = await applyBiorxivGate(gateCandidates);
    const { deduped, onReportDate } = applyPerSourceFilters(gateResult.papers, reportDate);

    return {
      papers: onReportDate,
      normalized: keywordMatched,
      stats: {
        sourceId: source.id,
        feedTitle: source.name,
        rssItemCount: fetchedCount,
        normalizedCount: keywordMatched.length,
        dedupedCount: deduped.length,
        onReportDateCount: onReportDate.length,
      },
    };
  } catch (error) {
    console.warn(
      `bioRxiv skipped for ${source.id} (${source.url}):`,
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

async function processRssSource(source: Source, reportDate: string): Promise<SourceProcessResult> {
  if (source.kind !== "rss") {
    throw new Error(`Source ${source.id} is not an RSS source`);
  }

  try {
    const feed = await fetchAndParseRss(source);
    const normalized = normalizeFeedItems(feed.items, source);
    const { deduped, onReportDate } = applyPerSourceFilters(normalized, reportDate);

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
