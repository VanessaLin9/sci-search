import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyPaperKeywords,
  classifySection,
  matchKeywords,
} from "../../../src/domain/life-science/classifyKeywords.js";

const testKeywords = {
  primary: ["single-cell", "Visium"],
  biology: ["immunology", "cancer"],
} as const;

test("matchKeywords is case-insensitive", () => {
  assert.deepEqual(matchKeywords("Single-Cell atlas", ["single-cell"]), ["single-cell"]);
});

test("classifySection prioritizes primary over biology", () => {
  assert.equal(classifySection(["single-cell"], ["immunology"]), "single-cell-spatial");
  assert.equal(classifySection([], ["immunology"]), "biology");
  assert.equal(classifySection([], []), "other");
});

test("classifyPaperKeywords uses title and abstract for matching", () => {
  const classified = classifyPaperKeywords(
    {
      title: "Unrelated headline",
      abstract: "We used Visium for spatial mapping.",
    },
    testKeywords,
  );
  assert.deepEqual(classified.matchedKeywords, ["Visium"]);
  assert.equal(classified.section, "single-cell-spatial");
});

test("classifyPaperKeywords assigns biology when only biology keywords match", () => {
  const classified = classifyPaperKeywords(
    { title: "Tumor immunology review", abstract: undefined },
    testKeywords,
  );
  assert.deepEqual(classified.matchedKeywords, ["immunology"]);
  assert.equal(classified.section, "biology");
});

test("classifyPaperKeywords assigns other when no keywords match", () => {
  const classified = classifyPaperKeywords(
    { title: "Generic methods note", abstract: "No keyword hits here." },
    testKeywords,
  );
  assert.deepEqual(classified.matchedKeywords, []);
  assert.equal(classified.section, "other");
});

test("classifyPaperKeywords merges primary and biology matches in order", () => {
  const classified = classifyPaperKeywords(
    {
      title: "single-cell cancer immunology",
      abstract: undefined,
    },
    testKeywords,
  );
  assert.deepEqual(classified.matchedKeywords, ["single-cell", "immunology", "cancer"]);
  assert.equal(classified.section, "single-cell-spatial");
});
