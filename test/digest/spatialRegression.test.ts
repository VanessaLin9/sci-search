import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadSources } from "../../src/config.js";
import { applySpatialBatchRows } from "../../src/domain/life-science/digest/applySpatialBatchRows.js";
import { resolveDigestLines } from "../../src/domain/life-science/digest/resolveDigestLines.js";
import {
  buildSourcePriorityById,
  selectFeatured,
} from "../../src/domain/life-science/digest/selection.js";
import { shouldSkipForDigest } from "../../src/domain/life-science/digest/skipNonResearch.js";
import { fallbackDigestLine } from "../../src/domain/life-science/fallbackDigestLine.js";
import { isPreprintSource } from "../../src/domain/life-science/sources.js";
import { isVisibleInDigest } from "../../src/domain/life-science/email/visibility.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type FixturePaper = {
  id: string;
  sourceId: string;
  title: string;
  section: "single-cell-spatial" | "biology" | "other";
  digestLine?: "line-a" | "line-b" | "preprint" | "skip";
  digestTaggingMethod?: "llm" | "keyword-fallback";
  abstract?: string;
  matchedKeywords?: string[];
};

function loadFixture(reportDate: string): FixturePaper[] {
  const fixturePath = path.join(
    repoRoot,
    "test/fixtures/spatial",
    `${reportDate}-papers.json`,
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { papers: FixturePaper[] };
  return fixture.papers;
}

function toResolveInput(paper: FixturePaper) {
  return {
    id: paper.id,
    title: paper.title,
    sourceId: paper.sourceId,
    section: paper.section,
    abstract: paper.abstract,
    matchedKeywords: paper.matchedKeywords,
  };
}

for (const reportDate of ["2026-08-17", "2026-08-18", "2026-08-19"] as const) {
  test(`spatial regression ${reportDate}: keyword-spatial non-preprints stay line-a (no tagging demotion)`, () => {
    const papers = loadFixture(reportDate);
    const spatialNonPreprint = papers.filter(
      (paper) =>
        paper.section === "single-cell-spatial" &&
        !isPreprintSource(paper.sourceId) &&
        !shouldSkipForDigest(paper),
    );

    const resolved = resolveDigestLines(
      spatialNonPreprint.map(toResolveInput),
      new Map(),
      new Set(),
    );

    for (const paper of resolved) {
      assert.equal(
        paper.digestLine,
        "line-a",
        `${paper.id} must stay line-a under keyword spatial fallback (was ${papers.find((p) => p.id === paper.id)?.digestLine} via old tagging)`,
      );
      assert.equal(paper.digestTaggingMethod, "keyword-fallback");
    }
  });

  test(`spatial regression ${reportDate}: high-confidence spatial LLM cannot be demoted to B`, () => {
    const papers = loadFixture(reportDate);
    const nonPreprint = papers.filter((paper) => !isPreprintSource(paper.sourceId));
    if (nonPreprint.length === 0) return;

    const applied = applySpatialBatchRows(
      nonPreprint.map((paper) => paper.id),
      nonPreprint.map((paper) => ({
        id: paper.id,
        spatial_confidence: paper.section === "single-cell-spatial" ? 0.92 : 0.2,
      })),
      0.75,
    );

    const resolved = resolveDigestLines(
      nonPreprint.map(toResolveInput),
      applied.lineById,
      applied.llmClassifiedIds,
    );

    for (const paper of resolved) {
      const original = nonPreprint.find((item) => item.id === paper.id)!;
      if (shouldSkipForDigest(original)) {
        assert.equal(paper.digestLine, "skip");
        continue;
      }
      if (original.section === "single-cell-spatial") {
        assert.equal(paper.digestLine, "line-a");
        assert.equal(paper.digestTaggingMethod, "llm");
      } else {
        assert.equal(paper.digestLine, "line-b");
      }
    }
  });

  test(`spatial regression ${reportDate}: biorxiv always preprint pool`, () => {
    const papers = loadFixture(reportDate);
    const biorxiv = papers.filter((paper) => paper.sourceId === "biorxiv");
    const resolved = resolveDigestLines(
      biorxiv.map(toResolveInput),
      new Map(biorxiv.map((paper) => [paper.id, "line-a" as const])),
      new Set(biorxiv.map((paper) => paper.id)),
    );
    for (const paper of resolved) {
      assert.equal(paper.digestLine, "preprint");
    }
  });
}

test("spatial regression: missing-abstract research stays visible overflow, not skip", () => {
  const papers = [
    {
      id: "missing-abs",
      title: "A long-form spatial transcriptomics study without abstract text yet",
      sourceId: "nature-methods",
      section: "single-cell-spatial" as const,
      matchedKeywords: ["spatial transcriptomics"],
      abstract: "",
      digestLine: "line-a" as const,
    },
    {
      id: "with-abs",
      title: "Another spatial transcriptomics study with abstract",
      sourceId: "science",
      section: "single-cell-spatial" as const,
      matchedKeywords: ["spatial transcriptomics"],
      abstract: "Usable English abstract.",
      digestLine: "line-a" as const,
    },
  ];

  const resolved = resolveDigestLines(
    papers.map(toResolveInput),
    new Map(),
    new Set(),
  );
  assert.equal(resolved.find((paper) => paper.id === "missing-abs")?.digestLine, "line-a");
  assert.equal(isVisibleInDigest(resolved.find((paper) => paper.id === "missing-abs")!), true);

  const { papers: selected, stats, diagnostics } = selectFeatured(resolved, {
    maxFeatured: 12,
    priorityBySourceId: buildSourcePriorityById([
      { id: "nature-methods", priority: 1 },
      { id: "science", priority: 5 },
    ]),
  });

  assert.equal(stats.candidates, 2);
  assert.equal(stats.featured, 1);
  assert.equal(stats.overflow, 1);
  assert.equal(diagnostics.featuredIneligibleMissingAbstract, 1);
  assert.equal(selected.find((paper) => paper.id === "missing-abs")?.featured, false);
  assert.equal(selected.find((paper) => paper.id === "with-abs")?.featured, true);
});

test("spatial regression: named editorial fixtures stay skip and invisible", () => {
  const titles = new Set([
    "Trainee advice for a future that seems uncertain",
    "From reading to writing",
  ]);
  const papers = ["2026-08-17", "2026-08-19"].flatMap((date) =>
    loadFixture(date).filter((paper) => titles.has(paper.title)),
  );
  assert.equal(papers.length, 2);

  const resolved = resolveDigestLines(
    papers.map(toResolveInput),
    new Map(papers.map((paper) => [paper.id, "line-b" as const])),
    new Set(papers.map((paper) => paper.id)),
  );

  for (const paper of resolved) {
    assert.equal(paper.digestLine, "skip", paper.title);
    assert.equal(isVisibleInDigest(paper), false, paper.title);
  }
});

test("spatial regression selection: A+B fill before preprint on 2026-08-19 fixture", async () => {
  const papers = loadFixture("2026-08-19").map((paper) => ({
    ...paper,
    digestLine: fallbackDigestLine(paper),
    abstract: paper.abstract?.trim() ? paper.abstract : "Synthetic abstract for eligibility.",
  }));
  const sources = await loadSources();
  const { stats, papers: selected } = selectFeatured(papers, {
    maxFeatured: 12,
    priorityBySourceId: buildSourcePriorityById(sources),
  });

  assert.ok(stats.featured <= 12);
  assert.equal(stats.featured + stats.overflow, stats.candidates);

  const featured = selected.filter((paper) => paper.featured);
  const featuredPreprint = featured.filter((paper) => paper.digestLine === "preprint");
  const featuredMain = featured.filter(
    (paper) => paper.digestLine === "line-a" || paper.digestLine === "line-b",
  );

  if (featuredMain.length >= 12) {
    assert.equal(featuredPreprint.length, 0);
  }
});
