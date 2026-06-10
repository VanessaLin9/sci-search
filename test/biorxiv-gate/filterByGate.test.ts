import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPapersByBiorxivGate } from "../../src/biorxiv-gate/filterByGate.js";
import type { Paper } from "../../src/types.js";

function paper(id: string): Paper {
  return {
    id,
    title: `Title ${id}`,
    journal: "bioRxiv",
    publishedDate: "2026-06-01",
    url: `https://example.com/${id}`,
    sourceId: "biorxiv",
  };
}

test("filterPapersByBiorxivGate keeps only yes verdicts", () => {
  const papers = [paper("a"), paper("b"), paper("c")];
  const verdictById = new Map([
    ["a", "yes" as const],
    ["b", "no" as const],
    ["c", "not_sure" as const],
  ]);

  const result = filterPapersByBiorxivGate(papers, verdictById);

  assert.deepEqual(
    result.included.map((entry) => entry.id),
    ["a"],
  );
  assert.equal(result.excluded.length, 2);
  assert.equal(result.yes, 1);
  assert.equal(result.no, 1);
  assert.equal(result.notSure, 1);
});

test("filterPapersByBiorxivGate throws when a verdict is missing", () => {
  assert.throws(
    () => filterPapersByBiorxivGate([paper("a")], new Map()),
    /Missing bioRxiv gate verdict/,
  );
});
