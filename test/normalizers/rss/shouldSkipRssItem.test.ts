import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "rss-parser";
import { shouldSkipRssItem } from "../../../src/normalizers/rss/index.js";

test("shouldSkipRssItem returns false for unknown sourceId", () => {
  assert.equal(shouldSkipRssItem("unknown-source", {} as Item), false);
});

test("shouldSkipRssItem returns false when registered rule says no", () => {
  assert.equal(shouldSkipRssItem("pnas", { title: "Some research" } as Item), false);
});

test("shouldSkipRssItem returns true when registered rule says yes", () => {
  assert.equal(shouldSkipRssItem("pnas", { title: "In This Issue" } as Item), true);
});
