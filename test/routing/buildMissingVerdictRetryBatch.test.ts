import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissingVerdictRetryBatch } from "../../src/routing/classifyBroadScience.js";
import type { BroadScienceRoutingInput } from "../../src/routing/types.js";

function paper(id: string): BroadScienceRoutingInput {
  return { id, title: `Title ${id}`, journal: "Test", source_id: "science" };
}

test("buildMissingVerdictRetryBatch concentrates multiple missing papers in one batch", () => {
  const items = [paper("a"), paper("b"), paper("c"), paper("d")];
  const retryBatch = buildMissingVerdictRetryBatch(items, ["b", "d"]);
  assert.deepEqual(
    retryBatch.map((item) => item.id),
    ["b", "d"],
  );
});

test("buildMissingVerdictRetryBatch retries the half containing a single missing paper", () => {
  const items = [paper("a"), paper("b"), paper("c"), paper("d")];
  const retryBatch = buildMissingVerdictRetryBatch(items, ["c"]);
  assert.deepEqual(
    retryBatch.map((item) => item.id),
    ["c", "d"],
  );
});

test("buildMissingVerdictRetryBatch retries first half when missing paper is there", () => {
  const items = [paper("a"), paper("b"), paper("c"), paper("d")];
  const retryBatch = buildMissingVerdictRetryBatch(items, ["a"]);
  assert.deepEqual(
    retryBatch.map((item) => item.id),
    ["a", "b"],
  );
});
