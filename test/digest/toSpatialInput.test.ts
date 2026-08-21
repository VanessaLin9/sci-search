import assert from "node:assert/strict";
import { test } from "node:test";
import { toSpatialClassifyInput } from "../../src/digest/toSpatialInput.js";
import type { ClassifiedPaper } from "../../src/types.js";

function paper(overrides: Partial<ClassifiedPaper> = {}): ClassifiedPaper {
  return {
    id: "p-1",
    title: "Spatial transcriptomics of the mouse brain",
    journal: "Nature Methods",
    publishedDate: "2026-08-19",
    url: "https://example.com",
    sourceId: "nature-methods",
    matchedKeywords: ["spatial transcriptomics"],
    section: "single-cell-spatial",
    abstract: "A".repeat(50),
    ...overrides,
  };
}

test("toSpatialClassifyInput omits source_id and truncates long abstracts", () => {
  const input = toSpatialClassifyInput(paper({ abstract: "x".repeat(2500) }));
  assert.equal(input.id, "p-1");
  assert.equal(input.title.includes("Spatial"), true);
  assert.equal(input.journal, "Nature Methods");
  assert.ok(input.abstract?.endsWith("…"));
  assert.ok((input.abstract?.length ?? 0) <= 2001);
  assert.equal("source_id" in input, false);
  assert.equal("sourceId" in input, false);
});
