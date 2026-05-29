import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSourcePriorityById,
  compareForFeatured,
  selectFeatured,
} from "../../../../src/domain/life-science/digest/selection.js";

type RankedPaper = {
  id: string;
  sourceId: string;
  title: string;
  digestLine?: "line-a" | "line-b" | "preprint" | "skip";
};

type RankedPaperWithFeatured = RankedPaper & { featured: boolean };

function ranked(
  id: string,
  options: Partial<RankedPaper> & Pick<RankedPaper, "sourceId" | "title">,
): RankedPaper {
  return { id, digestLine: "line-b", ...options };
}

const priorityBySourceId = buildSourcePriorityById([
  { id: "nature-methods", priority: 1 },
  { id: "science", priority: 5 },
]);

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
