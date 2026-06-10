import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countPapersByCategory,
  formatCategoryCounts,
} from "../../src/biorxiv/categoryCounts.js";
import type { Paper } from "../../src/types.js";

function paper(category: string, id = "id"): Paper {
  return {
    id,
    title: "Title",
    journal: "bioRxiv",
    publishedDate: "2026-06-01",
    url: "https://example.com",
    articleType: category,
    sourceId: "biorxiv",
  };
}

test("countPapersByCategory groups by articleType", () => {
  const counts = countPapersByCategory([
    paper("bioinformatics", "a"),
    paper("genomics", "b"),
    paper("bioinformatics", "c"),
  ]);

  assert.equal(counts.get("bioinformatics"), 2);
  assert.equal(counts.get("genomics"), 1);
});

test("formatCategoryCounts sorts categories for stable logs", () => {
  const formatted = formatCategoryCounts(
    new Map([
      ["genomics", 3],
      ["bioinformatics", 7],
    ]),
  );

  assert.equal(formatted, "bioinformatics=7, genomics=3");
});
