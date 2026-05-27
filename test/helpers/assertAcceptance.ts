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

export function assertGoldenPipelineOutput(processed: ProcessedPapersFile, reportDate: string): void {
  validateProcessedPapersFile(processed);
  assert.equal(processed.reportDate, reportDate);

  const { maxFeatured } = loadDigestFileConfig();
  assertTitlesArePlainText(processed.papers);
  assertReportDateAlignment(processed.papers, reportDate);
  assertFeaturedInvariants(processed.papers, maxFeatured);
  assertSelectionStats(processed);
  assertSummarizeStats(processed);

  const meg3Paper = processed.papers.find((paper) => paper.id.includes("03130-z"));
  assert.ok(meg3Paper, "expected HTML-title fixture paper in output");
  assert.match(meg3Paper!.title, /Meg3\+/, "HTML gene marker should normalize to Meg3+");
}

export function assertDigestHtml(html: string, processed: ProcessedPapersFile): void {
  assert.match(html, /每日科學期刊摘要/);
  assert.match(html, new RegExp(processed.reportDate));
  assert.match(html, /color:#2c5f8d/);
  assert.match(html, /doi\.org\//);

  const visibleCount = processed.papers.filter(
    (paper) => paper.digestLine && paper.digestLine !== "skip",
  ).length;
  assert.match(html, new RegExp(`精選 ${processed.papers.filter((paper) => paper.featured).length}`));
  assert.match(html, new RegExp(`更多收錄 ${Math.max(0, visibleCount - processed.papers.filter((paper) => paper.featured).length)}`));

  assert.doesNotMatch(html, /<i>Meg3<\/i>/, "rendered HTML should not leak raw RSS title tags");
  assert.match(html, /Meg3\+/);
}
