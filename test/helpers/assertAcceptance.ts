import assert from "node:assert/strict";
import { loadDigestFileConfig } from "../../src/config.js";
import { validateProcessedPapersFile, type ProcessedPapersFile } from "../../src/processedData.js";
import type { ClassifiedPaper } from "../../src/types.js";

function assertTitlesArePlainText(papers: ClassifiedPaper[]): void {
  for (const paper of papers) {
    assert.doesNotMatch(
      paper.title,
      /<[a-z]/i,
      `title should not contain HTML tags: ${paper.id}`,
    );
  }
}

function assertReportDateAlignment(papers: ClassifiedPaper[], reportDate: string): void {
  for (const paper of papers) {
    assert.ok(
      paper.publishedDate.startsWith(reportDate),
      `paper ${paper.id} publishedDate ${paper.publishedDate} should match ${reportDate}`,
    );
  }
}

function assertFeaturedInvariants(papers: ClassifiedPaper[], maxFeatured: number): void {
  const featured = papers.filter((paper) => paper.featured);
  assert.ok(featured.length <= maxFeatured, `featured count ${featured.length} exceeds max ${maxFeatured}`);

  for (const paper of featured) {
    assert.notEqual(paper.digestLine, "skip", `featured paper ${paper.id} must not be skip`);
    assert.ok(paper.titleZh?.trim(), `featured paper ${paper.id} should have titleZh`);
    assert.ok(paper.summaryZh?.trim(), `featured paper ${paper.id} should have summaryZh`);
    assert.ok(paper.topicTags && paper.topicTags.length > 0, `featured paper ${paper.id} needs topicTags`);
  }
}

function assertSelectionStats(processed: ProcessedPapersFile): void {
  const { papers, digest } = processed;
  assert.ok(digest, "digest stats block is required");

  const selection = digest.selection;
  const visible = papers.filter((paper) => paper.digestLine && paper.digestLine !== "skip");
  const featured = papers.filter((paper) => paper.featured);
  const overflow = visible.filter((paper) => !paper.featured);
  const skip = papers.filter((paper) => paper.digestLine === "skip");

  assert.equal(selection.total, papers.length);
  assert.equal(selection.candidates, visible.length);
  assert.equal(selection.featured, featured.length);
  assert.equal(selection.overflow, overflow.length);
  assert.equal(selection.skip, skip.length);
  assert.equal(selection.featured + selection.overflow, selection.candidates);
}

function assertSummarizeStats(processed: ProcessedPapersFile): void {
  const { digest } = processed;
  assert.ok(digest?.summarize, "summarize stats are required when LLM digest is on");
  const summarize = digest.summarize!;
  assert.equal(
    summarize.llmSummarized + summarize.failed,
    summarize.requested,
    "summarize counters should add up",
  );
  assert.equal(summarize.requested, processed.papers.filter((paper) => paper.featured).length);
}

function assertTranslateStats(processed: ProcessedPapersFile): void {
  const { digest, papers } = processed;
  assert.ok(digest?.translate, "translate stats are required when LLM digest is on");
  const translate = digest.translate!;
  const overflowCount = papers.filter(
    (paper) => !paper.featured && paper.digestLine && paper.digestLine !== "skip",
  ).length;

  assert.equal(translate.llmTranslated + translate.failed, translate.requested);
  assert.equal(translate.requested, overflowCount);
}

/** Shared schema + invariants for any non-empty pipeline run. */
export function assertPipelineOutput(processed: ProcessedPapersFile, reportDate: string): void {
  validateProcessedPapersFile(processed);
  assert.equal(processed.reportDate, reportDate);

  const { maxFeatured } = loadDigestFileConfig();
  assertTitlesArePlainText(processed.papers);
  assertReportDateAlignment(processed.papers, reportDate);
  assertFeaturedInvariants(processed.papers, maxFeatured);
  assertSelectionStats(processed);
  assertSummarizeStats(processed);
}

/** Minimal synthetic golden feed (6 papers, HTML title Meg3+). */
export function assertSyntheticGoldenOutput(processed: ProcessedPapersFile, reportDate: string): void {
  assertPipelineOutput(processed, reportDate);

  const meg3Paper = processed.papers.find((paper) => paper.id.includes("03130-z"));
  assert.ok(meg3Paper, "expected HTML-title fixture paper in output");
  assert.match(meg3Paper!.title, /Meg3\+/, "HTML gene marker should normalize to Meg3+");
}

/** Frozen RSS snapshot busy day (many papers, featured full, overflow). */
export function assertSnapshotBusyDayOutput(
  processed: ProcessedPapersFile,
  reportDate: string,
  options: { minPapers: number },
): void {
  assertPipelineOutput(processed, reportDate);
  assertTranslateStats(processed);

  const { maxFeatured } = loadDigestFileConfig();
  assert.ok(
    processed.papers.length >= options.minPapers,
    `expected at least ${options.minPapers} papers, got ${processed.papers.length}`,
  );
  assert.equal(processed.digest?.selection.featured, maxFeatured, "featured should fill maxFeatured");
  assert.ok(
    (processed.digest?.selection.overflow ?? 0) > 0,
    "busy day should have overflow papers",
  );
}

/** Frozen RSS snapshot with zero papers on report date. */
export function assertEmptyPipelineOutput(processed: ProcessedPapersFile, reportDate: string): void {
  validateProcessedPapersFile(processed);
  assert.equal(processed.reportDate, reportDate);
  assert.equal(processed.papers.length, 0);
  assert.equal(processed.digest?.selection.total, 0);
  assert.equal(processed.digest?.selection.featured, 0);
  assert.equal(processed.digest?.summarize?.requested, 0);
  assert.equal(processed.digest?.translate?.requested, 0);
}

export function assertDigestHtml(html: string, processed: ProcessedPapersFile): void {
  assert.match(html, /每日科學期刊摘要/);
  assert.match(html, new RegExp(processed.reportDate));

  const visibleCount = processed.papers.filter(
    (paper) => paper.digestLine && paper.digestLine !== "skip",
  ).length;
  const featuredCount = processed.papers.filter((paper) => paper.featured).length;
  const overflowCount = Math.max(0, visibleCount - featuredCount);

  assert.match(html, new RegExp(`精選 ${featuredCount}`));
  assert.match(html, new RegExp(`更多收錄 ${overflowCount}`));

  if (featuredCount > 0) {
    assert.match(html, /color:#2c5f8d/);
    assert.match(html, /doi\.org\//);
  }
}

export function assertSyntheticDigestHtml(html: string, processed: ProcessedPapersFile): void {
  assertDigestHtml(html, processed);
  assert.doesNotMatch(html, /<i>Meg3<\/i>/, "rendered HTML should not leak raw RSS title tags");
  assert.match(html, /Meg3\+/);
}

export function assertBusyDayDigestHtml(html: string, processed: ProcessedPapersFile): void {
  assertDigestHtml(html, processed);
  assert.match(html, /更多收錄論文/);
  assert.match(html, /主線 A/);
  assert.match(html, /主線 B/);
}

export function assertEmptyDigestHtml(html: string, reportDate: string): void {
  assert.match(html, /每日科學期刊摘要/);
  assert.match(html, new RegExp(reportDate));
  assert.match(html, /今日沒有符合報告日的論文/);
  assert.match(html, /精選 0/);
  assert.match(html, /更多收錄 0/);
}
