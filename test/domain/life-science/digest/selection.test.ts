import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadSources } from "../../../../src/config.js";
import {
  buildSourcePriorityById,
  compareForFeatured,
  isEligibleForFeatured,
  selectFeatured,
} from "../../../../src/domain/life-science/digest/selection.js";

type RankedPaper = {
  id: string;
  sourceId: string;
  title: string;
  digestLine?: "line-a" | "line-b" | "preprint" | "skip";
  abstract?: string;
};

type RankedPaperWithFeatured = RankedPaper & { featured: boolean };

function ranked(
  id: string,
  options: Partial<RankedPaper> & Pick<RankedPaper, "sourceId" | "title">,
): RankedPaper {
  return { id, digestLine: "line-b", abstract: "Usable English abstract.", ...options };
}

const priorityBySourceId = buildSourcePriorityById([
  { id: "nature-methods", priority: 1 },
  { id: "science", priority: 5 },
]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("compareForFeatured sorts line-a before line-b before preprint", () => {
  const lineA = ranked("a", { sourceId: "science", title: "Z", digestLine: "line-a" });
  const lineB = ranked("b", { sourceId: "science", title: "A", digestLine: "line-b" });
  const preprint = ranked("c", { sourceId: "science", title: "M", digestLine: "preprint" });
  assert.ok(compareForFeatured(lineA, lineB, priorityBySourceId) < 0);
  assert.ok(compareForFeatured(lineB, preprint, priorityBySourceId) < 0);
});

test("compareForFeatured uses source priority within the same digest line", () => {
  const highPriority = ranked("a", { sourceId: "nature-methods", title: "B", digestLine: "line-b" });
  const lowPriority = ranked("b", { sourceId: "science", title: "A", digestLine: "line-b" });
  assert.ok(compareForFeatured(highPriority, lowPriority, priorityBySourceId) < 0);
});

test("compareForFeatured uses title when line and source priority match", () => {
  const earlier = ranked("a", { sourceId: "science", title: "Alpha", digestLine: "line-b" });
  const later = ranked("b", { sourceId: "science", title: "Beta", digestLine: "line-b" });
  assert.ok(compareForFeatured(earlier, later, priorityBySourceId) < 0);
});

test("isEligibleForFeatured requires non-skip line and trimmed abstract", () => {
  assert.equal(
    isEligibleForFeatured(ranked("ok", { sourceId: "science", title: "Ok" })),
    true,
  );
  assert.equal(
    isEligibleForFeatured(
      ranked("skip", { sourceId: "science", title: "Skip", digestLine: "skip" }),
    ),
    false,
  );
  assert.equal(
    isEligibleForFeatured(
      ranked("missing", { sourceId: "science", title: "Missing", abstract: undefined }),
    ),
    false,
  );
  assert.equal(
    isEligibleForFeatured(
      ranked("empty", { sourceId: "science", title: "Empty", abstract: "" }),
    ),
    false,
  );
  assert.equal(
    isEligibleForFeatured(
      ranked("blank", { sourceId: "science", title: "Blank", abstract: "   " }),
    ),
    false,
  );
});

test("selectFeatured never features skip papers", () => {
  const papers = [
    ranked("skip-1", { sourceId: "science", title: "Skipped", digestLine: "skip" }),
    ranked("feat-1", { sourceId: "science", title: "Featured", digestLine: "line-a" }),
  ];
  const { papers: selected, stats } = selectFeatured(papers, {
    maxFeatured: 12,
    priorityBySourceId,
  });
  const withFeatured = selected as RankedPaperWithFeatured[];
  assert.equal(stats.candidates, 1);
  assert.equal(stats.featured, 1);
  assert.equal(stats.skip, 1);
  assert.equal(withFeatured.find((paper) => paper.id === "skip-1")?.featured, false);
  assert.equal(withFeatured.find((paper) => paper.id === "feat-1")?.featured, true);
});

test("selectFeatured caps featured count and reports overflow stats", () => {
  const papers = [
    ranked("a", { sourceId: "science", title: "A", digestLine: "line-a" }),
    ranked("b", { sourceId: "science", title: "B", digestLine: "line-b" }),
    ranked("c", { sourceId: "science", title: "C", digestLine: "preprint" }),
  ];
  const { stats } = selectFeatured(papers, { maxFeatured: 2, priorityBySourceId });
  assert.deepEqual(stats, {
    total: 3,
    candidates: 3,
    featured: 2,
    overflow: 1,
    lineA: 1,
    lineB: 1,
    preprint: 1,
    skip: 0,
  });
});

test("selectFeatured skips missing/blank abstracts and backfills from next eligible", () => {
  const papers = [
    ranked("no-abs", {
      sourceId: "nature-methods",
      title: "A first",
      digestLine: "line-a",
      abstract: "",
    }),
    ranked("blank-abs", {
      sourceId: "nature-methods",
      title: "B second",
      digestLine: "line-a",
      abstract: "  ",
    }),
    ranked("undefined-abs", {
      sourceId: "nature-methods",
      title: "C third",
      digestLine: "line-a",
      abstract: undefined,
    }),
    ranked("ok-1", {
      sourceId: "science",
      title: "D eligible",
      digestLine: "line-b",
    }),
    ranked("ok-2", {
      sourceId: "science",
      title: "E eligible",
      digestLine: "preprint",
    }),
  ];
  const { papers: selected, stats, diagnostics } = selectFeatured(papers, {
    maxFeatured: 2,
    priorityBySourceId,
  });
  const withFeatured = selected as RankedPaperWithFeatured[];
  const featuredIds = withFeatured.filter((paper) => paper.featured).map((paper) => paper.id);

  assert.deepEqual(featuredIds, ["ok-1", "ok-2"]);
  assert.equal(stats.candidates, 5);
  assert.equal(stats.featured, 2);
  assert.equal(stats.overflow, 3);
  assert.equal(diagnostics.featuredIneligibleMissingAbstract, 3);
  assert.equal(withFeatured.find((paper) => paper.id === "no-abs")?.featured, false);
});

test("selectFeatured underfills when eligible candidates are short", () => {
  const papers = [
    ranked("empty-1", {
      sourceId: "nature-methods",
      title: "A",
      digestLine: "line-a",
      abstract: "",
    }),
    ranked("ok", {
      sourceId: "science",
      title: "B",
      digestLine: "line-b",
    }),
    ranked("empty-2", {
      sourceId: "science",
      title: "C",
      digestLine: "preprint",
      abstract: undefined,
    }),
  ];
  const { papers: selected, stats, diagnostics } = selectFeatured(papers, {
    maxFeatured: 3,
    priorityBySourceId,
  });
  const withFeatured = selected as RankedPaperWithFeatured[];

  assert.equal(stats.candidates, 3);
  assert.equal(stats.featured, 1);
  assert.equal(stats.overflow, 2);
  assert.equal(diagnostics.featuredIneligibleMissingAbstract, 2);
  assert.equal(withFeatured.filter((paper) => paper.featured).length, 1);
  assert.equal(withFeatured.find((paper) => paper.id === "ok")?.featured, true);
  for (const paper of withFeatured.filter((item) => item.featured)) {
    assert.ok(paper.abstract?.trim());
  }
});

for (const reportDate of ["2026-07-28", "2026-07-31"] as const) {
  test(`selectFeatured regression ${reportDate}: no empty-abstract featured cards`, async () => {
    // Fixed fixtures under test/fixtures — do not read data/processed (30-day retention).
    const fixturePath = path.join(
      repoRoot,
      "test/fixtures/selection",
      `empty-abstract-featured-${reportDate}.json`,
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      papers: Array<{
        id: string;
        sourceId: string;
        title: string;
        digestLine?: "line-a" | "line-b" | "preprint" | "skip";
        abstract?: string;
        featured?: boolean;
      }>;
    };
    const sources = await loadSources();
    const { papers: selected, stats, diagnostics } = selectFeatured(fixture.papers, {
      maxFeatured: 12,
      priorityBySourceId: buildSourcePriorityById(sources),
    });

    const featured = selected.filter((paper) => paper.featured);
    assert.ok(featured.length > 0, "expected some featured papers");
    assert.ok(featured.length <= 12);
    assert.equal(stats.featured + stats.overflow, stats.candidates);
    assert.ok(diagnostics.featuredIneligibleMissingAbstract >= 3);

    for (const paper of featured) {
      assert.ok(
        paper.abstract?.trim(),
        `featured ${paper.id} must have trimmed abstract`,
      );
    }

    const historicallyEmptyFeatured = fixture.papers.filter(
      (paper) => paper.featured && !(paper.abstract ?? "").trim(),
    );
    assert.ok(historicallyEmptyFeatured.length >= 3, "fixture should still contain the empty-card cases");
    for (const paper of historicallyEmptyFeatured) {
      const updated = selected.find((item) => item.id === paper.id);
      assert.equal(updated?.featured, false, `${paper.id} should drop out of featured`);
    }
  });
}
