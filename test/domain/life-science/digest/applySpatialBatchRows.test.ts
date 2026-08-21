import assert from "node:assert/strict";
import { test } from "node:test";
import { applySpatialBatchRows } from "../../../../src/domain/life-science/digest/applySpatialBatchRows.js";

test("applySpatialBatchRows: confidence at/above/below threshold", () => {
  const applied = applySpatialBatchRows(
    ["eq", "hi", "lo"],
    [
      { id: "eq", spatial_confidence: 0.75 },
      { id: "hi", spatial_confidence: 0.9 },
      { id: "lo", spatial_confidence: 0.74 },
    ],
    0.75,
  );
  assert.equal(applied.lineById.get("eq"), "line-a");
  assert.equal(applied.lineById.get("hi"), "line-a");
  assert.equal(applied.lineById.get("lo"), "line-b");
  assert.equal(applied.keywordFallbackIds.length, 0);
  assert.equal(applied.failures, 0);
  assert.equal(applied.llmClassifiedIds.size, 3);
});

test("applySpatialBatchRows: malformed missing id and out-of-range confidence fallback", () => {
  const applied = applySpatialBatchRows(
    ["ok", "bad-range", "missing"],
    [
      { id: "ok", spatial_confidence: 0.8 },
      { id: "bad-range", spatial_confidence: 1.5 },
      { id: "unknown", spatial_confidence: 0.9 },
    ],
    0.75,
  );
  assert.equal(applied.lineById.get("ok"), "line-a");
  assert.deepEqual(applied.keywordFallbackIds.sort(), ["bad-range", "missing"]);
  assert.equal(applied.failures, 3); // unknown row + bad-range + missing
  assert.ok(!applied.llmClassifiedIds.has("bad-range"));
});

test("applySpatialBatchRows: partial batch leaves missing ids for keyword fallback", () => {
  const applied = applySpatialBatchRows(
    ["a", "b", "c"],
    [{ id: "a", spatial_confidence: 0.2 }],
    0.75,
  );
  assert.equal(applied.lineById.get("a"), "line-b");
  assert.deepEqual(applied.keywordFallbackIds, ["b", "c"]);
  assert.equal(applied.failures, 2);
});
