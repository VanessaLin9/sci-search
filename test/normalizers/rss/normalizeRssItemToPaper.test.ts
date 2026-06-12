import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDoi } from "../../../src/doi.js";
import { buildPaperId, normalizeRssItemToPaper } from "../../../src/normalize.js";
import { makeRssItem, makeRssSource } from "../../helpers/rssTestFixtures.js";

test("extractDoi pulls DOI from guid", () => {
  assert.equal(extractDoi("urn:doi:10.7554/eLife.12345"), "10.7554/eLife.12345");
});

test("extractDoi pulls DOI from link when guid has none", () => {
  assert.equal(
    extractDoi("https://doi.org/10.1038/s41586-026-00001-2"),
    "10.1038/s41586-026-00001-2",
  );
});

test("extractDoi pulls DOI from custom source field", () => {
  assert.equal(extractDoi("doi:10.1126/science.abc1234"), "10.1126/science.abc1234");
});

test("buildPaperId prefers DOI over URL and title", () => {
  assert.equal(
    buildPaperId({
      doi: "10.1234/ABC",
      url: "https://example.com/a",
      title: "Title",
    }),
    "10.1234/abc",
  );
});

test("normalizeRssItemToPaper returns null when title is missing", () => {
  const paper = normalizeRssItemToPaper(makeRssItem({ title: undefined }), makeRssSource("cell"));
  assert.equal(paper, null);
});

test("normalizeRssItemToPaper returns null when url is missing", () => {
  const paper = normalizeRssItemToPaper(makeRssItem({ link: undefined }), makeRssSource("cell"));
  assert.equal(paper, null);
});

test("normalizeRssItemToPaper returns null when publishedDate is missing", () => {
  const paper = normalizeRssItemToPaper(
    makeRssItem({ isoDate: undefined, pubDate: undefined }),
    makeRssSource("cell"),
  );
  assert.equal(paper, null);
});

test("normalizeRssItemToPaper returns null when registered skip rule matches", () => {
  const paper = normalizeRssItemToPaper(
    makeRssItem({ title: "In This Issue" }),
    makeRssSource("pnas"),
  );
  assert.equal(paper, null);
});

test("normalizeRssItemToPaper sets doi from guid before link", () => {
  const paper = normalizeRssItemToPaper(
    makeRssItem({
      guid: "10.7554/eLife.99999",
      link: "https://doi.org/10.1126/science.other",
    }),
    makeRssSource("cell"),
  );
  assert.ok(paper);
  assert.equal(paper.doi, "10.7554/eLife.99999");
  assert.equal(paper.id, "10.7554/elife.99999");
});

test("normalizeRssItemToPaper sets doi from item source when guid is empty", () => {
  const paper = normalizeRssItemToPaper(
    makeRssItem({
      guid: undefined,
      source: "doi:10.1126/science.abc9999",
      link: "https://example.com/article",
    }),
    makeRssSource("cell"),
  );
  assert.ok(paper);
  assert.equal(paper.doi, "10.1126/science.abc9999");
});

test("normalizeRssItemToPaper sets doi from dc:identifier for Cell RSS", () => {
  const paper = normalizeRssItemToPaper(
    makeRssItem({
      link: "https://www.cell.com/cell/fulltext/S0092-8674(26)00587-8?rss=yes",
      dcIdentifier: "10.1016/j.cell.2026.05.012",
    }),
    makeRssSource("cell"),
  );
  assert.ok(paper);
  assert.equal(paper.doi, "10.1016/j.cell.2026.05.012");
  assert.equal(paper.id, "10.1016/j.cell.2026.05.012");
});

test("normalizeRssItemToPaper uses default abstract extractor for unregistered source", () => {
  const paper = normalizeRssItemToPaper(
    makeRssItem({ contentSnippet: "Snippet abstract." }),
    makeRssSource("cell"),
  );
  assert.ok(paper);
  assert.equal(paper.abstract, "Snippet abstract.");
});
