import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBiorxivPaperUrl,
  normalizeBiorxivRecordToPaper,
  parseBiorxivAuthors,
} from "../../../src/normalizers/biorxiv.js";
import type { Source } from "../../../src/types.js";

const biorxivSource: Source = {
  id: "biorxiv",
  name: "bioRxiv",
  publisher: "bioRxiv",
  kind: "biorxiv-api",
  url: "https://api.biorxiv.org/details/biorxiv",
  priority: 99,
  scope: "life-science-only",
};

test("buildBiorxivPaperUrl includes DOI and version", () => {
  assert.equal(
    buildBiorxivPaperUrl("10.1101/2026.05.28.123456", "2"),
    "https://www.biorxiv.org/content/10.1101/2026.05.28.123456v2",
  );
});

test("parseBiorxivAuthors splits semicolon-separated names", () => {
  assert.deepEqual(parseBiorxivAuthors("Smith, J.; Doe, A."), ["Smith, J.", "Doe, A."]);
});

test("normalizeBiorxivRecordToPaper maps API fields to Paper", () => {
  const paper = normalizeBiorxivRecordToPaper(
    {
      title: "Single-cell atlas of spatial transcriptomics in test tissue",
      authors: "Smith, J.; Doe, A.",
      doi: "10.1101/2026.05.28.123456",
      date: "2026-05-28",
      version: "1",
      category: "cell biology",
      abstract: "We profile single cells with spatial transcriptomics across test tissue samples.",
    },
    biorxivSource,
  );

  assert.ok(paper);
  assert.equal(paper.id, "10.1101/2026.05.28.123456");
  assert.equal(paper.sourceId, "biorxiv");
  assert.equal(paper.journal, "bioRxiv");
  assert.equal(paper.publishedDate, "2026-05-28");
  assert.equal(paper.url, "https://www.biorxiv.org/content/10.1101/2026.05.28.123456v1");
  assert.deepEqual(paper.authors, ["Smith, J.", "Doe, A."]);
  assert.equal(paper.articleType, "cell biology");
});

test("normalizeBiorxivRecordToPaper returns null when required fields are missing", () => {
  assert.equal(
    normalizeBiorxivRecordToPaper(
      {
        title: "Missing date",
        doi: "10.1101/2026.05.28.999999",
      },
      biorxivSource,
    ),
    null,
  );
});
