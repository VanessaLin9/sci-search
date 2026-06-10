import { formatCategoryCounts } from "./categoryCounts.js";
import type { BiorxivCategoryFetchStat } from "../fetchBiorxiv.js";
import type { Paper } from "../types.js";
import { countPapersByCategory } from "./categoryCounts.js";

const PREFIX = "[biorxiv]";

export function logBiorxivIngest(message: string): void {
  console.log(`${PREFIX} ${message}`);
}

export function logBiorxivIngestHeader(reportDate: string): void {
  logBiorxivIngest(`ingest report_date=${reportDate}`);
}

export function logBiorxivApiStats(options: {
  categoryStats: readonly BiorxivCategoryFetchStat[];
  fetchedCount: number;
}): void {
  for (const stat of options.categoryStats) {
    if (stat.status === "skipped") {
      logBiorxivIngest(
        `api ${stat.category}: skipped${stat.error ? ` (${stat.error})` : ""}`,
      );
      continue;
    }
    logBiorxivIngest(`api ${stat.category}: ${stat.recordCount} record(s)`);
  }
  logBiorxivIngest(
    `api total: ${options.fetchedCount} raw record(s) across ${options.categoryStats.length} configured categor${options.categoryStats.length === 1 ? "y" : "ies"}`,
  );
}

export function logBiorxivNormalizedSummary(options: {
  rawRecordCount: number;
  normalizedCount: number;
  papers: readonly Paper[];
}): void {
  const skipped = options.rawRecordCount - options.normalizedCount;
  logBiorxivIngest(
    `normalized: ${options.normalizedCount} paper(s)` +
      (skipped > 0 ? ` (${skipped} record(s) skipped: missing title/doi/date)` : "") +
      ` · ${formatCategoryCounts(countPapersByCategory(options.papers))}`,
  );
}

export function logBiorxivPrimaryScreenSummary(options: {
  normalizedCount: number;
  keywordMatched: readonly Paper[];
  gateCandidates: readonly Paper[];
}): void {
  const { normalizedCount, keywordMatched, gateCandidates } = options;
  const dedupedRemoved = keywordMatched.length - gateCandidates.length;
  logBiorxivIngest(
    `primary screen: ${keywordMatched.length}/${normalizedCount} passed · ` +
      formatCategoryCounts(countPapersByCategory(keywordMatched)),
  );
  if (dedupedRemoved > 0) {
    logBiorxivIngest(
      `primary screen deduped: ${gateCandidates.length} gate candidate(s) (${dedupedRemoved} cross-category duplicate(s) removed)`,
    );
  }
}

export function logBiorxivFineScreenSummary(options: {
  candidates: number;
  passed: number;
  yes: number;
  no: number;
  notSure: number;
  passedPapers: readonly Paper[];
}): void {
  logBiorxivIngest(
    `fine screen: ${options.passed}/${options.candidates} passed ` +
      `(yes=${options.yes}, no=${options.no}, not_sure=${options.notSure}) · ` +
      formatCategoryCounts(countPapersByCategory(options.passedPapers)),
  );
}

export function logBiorxivFineScreenSkipped(options: {
  candidates: number;
  reason: string;
}): void {
  logBiorxivIngest(
    `fine screen skipped: ${options.reason}; using primary screen (${options.candidates} paper(s))`,
  );
}

export function logBiorxivReportDateSummary(options: {
  reportDate: string;
  afterFineScreenCount: number;
  gateCandidatesCount: number;
  onReportDateCount: number;
  papers: readonly Paper[];
}): void {
  if (options.afterFineScreenCount === 0) {
    logBiorxivIngest(
      `report date ${options.reportDate}: 0 on report date ` +
        `(fine screen left 0; ${options.gateCandidatesCount} gate candidate(s) before fine screen)`,
    );
    return;
  }

  const dropped = options.afterFineScreenCount - options.onReportDateCount;
  logBiorxivIngest(
    `report date ${options.reportDate}: ${options.onReportDateCount}/${options.afterFineScreenCount} paper(s)` +
      (dropped > 0 ? ` (${dropped} off-date)` : "") +
      ` · ${formatCategoryCounts(countPapersByCategory(options.papers))}`,
  );
}
