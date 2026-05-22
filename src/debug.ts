import { getPaperSections } from "./filterPapers.js";
import type { SourcePipelineStats } from "./pipeline.js";
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

  console.log(
    `${stats.sourceId}: ${stats.onReportDateCount} on report date (${stats.rssItemCount} RSS items) · ${sections}`,
  );
}

export function logSourceDetails(stats: SourcePipelineStats, normalizedPapers: Paper[]): void {
  console.log(`Feed: ${stats.feedTitle}`);
  console.log(`RSS items: ${stats.rssItemCount}`);
  console.log(`Normalized papers: ${stats.normalizedCount}`);
  printNormalizedPapers(stats.sourceId, normalizedPapers);
  console.log(`Deduped papers: ${stats.dedupedCount}`);
  console.log(`Papers on report date: ${stats.onReportDateCount}`);
  console.log(
    `Section counts: ${getPaperSections()
      .map((section) => `${section}: ${stats.sectionCounts[section]}`)
      .join(", ")}`,
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
