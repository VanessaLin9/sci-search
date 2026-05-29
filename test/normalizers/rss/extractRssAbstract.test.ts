import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRssAbstract } from "../../../src/normalizers/rss/index.js";
import { makeRssItem } from "../../helpers/rssTestFixtures.js";

test("extractRssAbstract uses default extractor for unregistered sourceId", () => {
  const item = makeRssItem({ contentSnippet: "Default abstract text." });
  assert.equal(extractRssAbstract("cell", item), "Default abstract text.");
});

test("extractRssAbstract routes registered science source to source-specific extractor", () => {
  const item = makeRssItem({ contentSnippet: "Would be used by default extractor." });
  assert.equal(extractRssAbstract("science", item), undefined);
});

test("extractRssAbstract routes registered pnas source to source-specific extractor", () => {
  const item = makeRssItem({ contentSnippet: "PNAS RSS snippet." });
  assert.equal(extractRssAbstract("pnas", item), undefined);
});

test("extractRssAbstract returns undefined when item has no abstract fields", () => {
  assert.equal(extractRssAbstract("unknown-journal", makeRssItem()), undefined);
});
