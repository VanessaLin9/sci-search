import { getPaperSections } from "./filterPapers.js";
import type { SourcePipelineStats } from "./pipeline.js";
import type { LifeScienceRoutingStats } from "./routing/types.js";
import type { Paper } from "./types.js";

export function isDebugEnabled(): boolean {
  const flag = process.env.DEBUG_NORMALIZED?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function logRunHeader(today: string, reportDate: string, configuredSourceCount: number): void {
  console.log("Paper Digest");
  console.log(`Date: ${today} (Asia/Taipei)`);
  console.log(`Report date: ${reportDate} (Asia/Taipei)`);
  console.log(`Configured sources: ${configuredSourceCount}`);
}

export function logSourceSummary(stats: SourcePipelineStats): void {
  const sections = getPaperSections()
    .map((section) => `${section}: ${stats.sectionCounts[section]}`)
    .join(", ");

  const enriched =
    stats.enrichedCount > 0 ? ` · enriched ${stats.enrichedCount}` : "";
  const excluded =
    stats.excludedCount > 0 ? ` · excluded ${stats.excludedCount}` : "";
  console.log(
    `${stats.sourceId}: ${stats.onReportDateCount} on report date (${stats.rssItemCount} RSS items)${enriched}${excluded} · ${sections}`,
  );
}

export function logSourceDetails(stats: SourcePipelineStats, normalizedPapers: Paper[]): void {
  console.log(`Feed: ${stats.feedTitle}`);
  console.log(`RSS items: ${stats.rssItemCount}`);
  console.log(`Normalized papers: ${stats.normalizedCount}`);
  printNormalizedPapers(stats.sourceId, normalizedPapers);
  console.log(`Deduped papers: ${stats.dedupedCount}`);
  console.log(`Papers on report date: ${stats.onReportDateCount}`);
  console.log(`Enriched abstracts: ${stats.enrichedCount}`);
  console.log(
    `Section counts: ${getPaperSections()
      .map((section) => `${section}: ${stats.sectionCounts[section]}`)
      .join(", ")}`,
  );
}

export function logEnrichResult(before: Paper, after: Paper): void {
  if (before.abstract?.trim()) return;

  const id = before.doi ?? before.id;
  if (!after.abstract?.trim()) {
    console.log(`Enrich ${before.sourceId} · ${id}: no abstract`);
    return;
  }

  const preview = after.abstract.slice(0, 100);
  const hasMarkup = /<jats\b|<\/?[a-z]/i.test(after.abstract);
  console.log(
    `Enrich ${before.sourceId} · ${id}: ok (${after.abstract.length} chars)${hasMarkup ? " [WARN: markup left]" : ""}`,
  );
  console.log(`  start: ${preview}${after.abstract.length > 100 ? "..." : ""}`);
}

export function logRoutingSummary(stats: LifeScienceRoutingStats, enabled: boolean): void {
  if (!enabled) {
    console.log("Life-science routing: disabled (set ROUTE_LIFE_SCIENCE=1 to enable)");
    return;
  }

  console.log(
    `Life-science routing: ${stats.included} included, ${stats.excluded} excluded ` +
      `(scope pass ${stats.passedByScope}, LLM ${stats.llmClassified}: ` +
      `yes ${stats.llmYes}, not_sure ${stats.llmNotSure}, no ${stats.llmNo})`,
  );
}

export function logClassifiedSample(papers: Paper[], limit = 3): void {
  if (papers.length === 0) return;

  console.log(
    papers.slice(0, limit).map((paper) => ({
      title: paper.title,
      matchedKeywords: paper.matchedKeywords,
      section: paper.section,
    })),
  );
}

function printNormalizedPapers(sourceId: string, papers: Paper[]): void {
  console.log(`Normalized papers detail (${sourceId}):`);
  console.table(
    papers.map((paper, index) => ({
      index: index + 1,
      id: paper.id,
      title: paper.title,
      publishedDate: paper.publishedDate,
      url: paper.url,
      doi: paper.doi ?? "(missing)",
      abstract: paper.abstract ? `${paper.abstract.slice(0, 120)}...` : "(missing)",
      sourceId: paper.sourceId,
    })),
  );
}
