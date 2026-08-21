import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD,
  digestLineFromSpatialConfidence,
  isValidSpatialConfidence,
} from "../../../../src/domain/life-science/digest/spatialConfidence.js";

test("digestLineFromSpatialConfidence: equal to threshold is line-a", () => {
  assert.equal(digestLineFromSpatialConfidence(0.75, 0.75), "line-a");
  assert.equal(
    digestLineFromSpatialConfidence(DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD, 0.75),
    "line-a",
  );
});

test("digestLineFromSpatialConfidence: above threshold is line-a", () => {
  assert.equal(digestLineFromSpatialConfidence(0.76, 0.75), "line-a");
  assert.equal(digestLineFromSpatialConfidence(1, 0.75), "line-a");
});

test("digestLineFromSpatialConfidence: below threshold is line-b", () => {
  assert.equal(digestLineFromSpatialConfidence(0.749, 0.75), "line-b");
  assert.equal(digestLineFromSpatialConfidence(0, 0.75), "line-b");
});

test("isValidSpatialConfidence accepts 0..1 inclusive", () => {
  assert.equal(isValidSpatialConfidence(0), true);
  assert.equal(isValidSpatialConfidence(1), true);
  assert.equal(isValidSpatialConfidence(0.5), true);
  assert.equal(isValidSpatialConfidence(-0.01), false);
  assert.equal(isValidSpatialConfidence(1.01), false);
  assert.equal(isValidSpatialConfidence(Number.NaN), false);
  assert.equal(isValidSpatialConfidence("0.5"), false);
});

test("digestLineFromSpatialConfidence throws on out-of-range confidence", () => {
  assert.throws(() => digestLineFromSpatialConfidence(1.5, 0.75), /out of range/);
});
