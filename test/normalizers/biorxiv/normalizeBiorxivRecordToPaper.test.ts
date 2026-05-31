import assert from "node:assert/strict";
import { test } from "node:test";
import { LIFE_SCIENCE_KEYWORDS } from "../../../src/domain/life-science/index.js";
import {
  buildBiorxivPaperUrl,
  filterBiorxivPapersByPrimaryKeywords,
  normalizeBiorxivRecordToPaper,
  paperMatchesPrimaryKeywords,
  parseBiorxivAuthors,
} from "../../../src/normalizers/biorxiv.js";
import type { Paper, Source } from "../../../src/types.js";

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

test("paperMatchesPrimaryKeywords matches single-cell/spatial terms in title or abstract", () => {
  assert.equal(
    paperMatchesPrimaryKeywords(
      {
        title: "Spatial transcriptomics atlas",
        abstract: "Methods paper.",
      },
      LIFE_SCIENCE_KEYWORDS,
    ),
    true,
  );
  assert.equal(
    paperMatchesPrimaryKeywords(
      {
        title: "Generic cell signaling review",
        abstract: "No omics keywords here.",
      },
      LIFE_SCIENCE_KEYWORDS,
    ),
    false,
  );
});

test("filterBiorxivPapersByPrimaryKeywords keeps only primary-keyword matches", () => {
  const papers: Paper[] = [
    {
      id: "a",
      title: "scRNA-seq atlas of liver zonation",
      journal: "bioRxiv",
      publishedDate: "2026-05-28",
      url: "https://example.com/a",
      sourceId: "biorxiv",
    },
    {
      id: "b",
      title: "Unrelated biochemistry preprint",
      journal: "bioRxiv",
      publishedDate: "2026-05-28",
      url: "https://example.com/b",
      sourceId: "biorxiv",
    },
  ];

  const filtered = filterBiorxivPapersByPrimaryKeywords(papers, LIFE_SCIENCE_KEYWORDS);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "a");
});
