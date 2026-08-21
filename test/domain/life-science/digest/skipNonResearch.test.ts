import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSkipForDigest } from "../../../../src/domain/life-science/digest/skipNonResearch.js";

test("shouldSkipForDigest: missing abstract alone is not skip", () => {
  assert.equal(
    shouldSkipForDigest({
      title: "Spatial transcriptomics maps the developing mouse brain across regions",
      sourceId: "nature-methods",
      section: "single-cell-spatial",
      matchedKeywords: ["spatial transcriptomics"],
      abstract: undefined,
    }),
    false,
  );
});

test("shouldSkipForDigest: career/advice title is skip even without abstract", () => {
  assert.equal(
    shouldSkipForDigest({
      title: "Trainee advice for a future that seems uncertain",
      sourceId: "nature-methods",
      section: "other",
      matchedKeywords: [],
    }),
    true,
  );
});

test("shouldSkipForDigest: short Nature editorial title without primary keywords is skip", () => {
  assert.equal(
    shouldSkipForDigest({
      title: "From reading to writing",
      sourceId: "nature-biotechnology",
      abstract:
        "DNA writing is entering a period of rapid innovation, with enzymatic and cellular approaches.",
      section: "biology",
      matchedKeywords: ["biology"],
    }),
    true,
  );
});

test("shouldSkipForDigest: research paper with abstract is not skip", () => {
  assert.equal(
    shouldSkipForDigest({
      title: "Spatial transcriptomics maps the developing mouse brain",
      sourceId: "nature-methods",
      abstract: "We present a spatial transcriptomics atlas of the developing mouse brain.",
      section: "single-cell-spatial",
      matchedKeywords: ["spatial transcriptomics"],
    }),
    false,
  );
});

test("shouldSkipForDigest: preprint is never skip here", () => {
  assert.equal(
    shouldSkipForDigest({
      title: "Editorial",
      sourceId: "biorxiv",
      abstract: "",
      section: "other",
    }),
    false,
  );
});

test("shouldSkipForDigest: explicit editorial articleType is skip", () => {
  assert.equal(
    shouldSkipForDigest({
      title: "A long research-looking title about cells",
      sourceId: "nature",
      abstract: "Something.",
      articleType: "Editorial",
    }),
    true,
  );
});
