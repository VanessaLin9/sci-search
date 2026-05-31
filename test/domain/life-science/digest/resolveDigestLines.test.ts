import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackDigestLine } from "../../../../src/domain/life-science/fallbackDigestLine.js";
import {
  applyKeywordDigestFallback,
  keywordFallbackTaggingStats,
  resolveDigestLines,
} from "../../../../src/domain/life-science/digest/resolveDigestLines.js";

type TaggedPaper = {
  id: string;
  sourceId: string;
  section: "single-cell-spatial" | "biology" | "other";
};

function paper(id: string, overrides: Partial<TaggedPaper> = {}): TaggedPaper {
  return { id, sourceId: "science", section: "biology", ...overrides };
}

test("fallbackDigestLine maps biorxiv to preprint", () => {
  assert.equal(fallbackDigestLine({ sourceId: "biorxiv", section: "other" }), "preprint");
});

test("fallbackDigestLine maps single-cell-spatial section to line-a", () => {
  assert.equal(
    fallbackDigestLine({ sourceId: "science", section: "single-cell-spatial" }),
    "line-a",
  );
});

test("fallbackDigestLine maps other sections to line-b", () => {
  assert.equal(fallbackDigestLine({ sourceId: "science", section: "biology" }), "line-b");
});

test("resolveDigestLines uses LLM digest line when present", () => {
  const [resolved] = resolveDigestLines(
    [paper("p-1")],
    new Map([["p-1", "line-a"]]),
    new Set(["p-1"]),
  );
  assert.equal(resolved.digestLine, "line-a");
  assert.equal(resolved.digestTaggingMethod, "llm");
});

test("resolveDigestLines falls back when LLM line is missing", () => {
  const [resolved] = resolveDigestLines(
    [paper("p-1", { section: "single-cell-spatial" })],
    new Map(),
    new Set(),
  );
  assert.equal(resolved.digestLine, "line-a");
  assert.equal(resolved.digestTaggingMethod, "keyword-fallback");
});

test("resolveDigestLines forces preprint for biorxiv even when LLM tags line-a", () => {
  const [resolved] = resolveDigestLines(
    [paper("p-1", { sourceId: "biorxiv", section: "single-cell-spatial" })],
    new Map([["p-1", "line-a"]]),
    new Set(["p-1"]),
  );
  assert.equal(resolved.digestLine, "preprint");
  assert.equal(resolved.digestTaggingMethod, "llm");
});

test("resolveDigestLines forces preprint for biorxiv even when LLM tags line-b", () => {
  const [resolved] = resolveDigestLines(
    [paper("p-1", { sourceId: "biorxiv", section: "biology" })],
    new Map([["p-1", "line-b"]]),
    new Set(["p-1"]),
  );
  assert.equal(resolved.digestLine, "preprint");
});

test("applyKeywordDigestFallback tags every paper with keyword-fallback", () => {
  const resolved = applyKeywordDigestFallback([
    paper("p-1", { section: "other" }),
    paper("p-2", { sourceId: "biorxiv", section: "biology" }),
  ]);
  assert.equal(resolved[0]?.digestLine, "line-b");
  assert.equal(resolved[1]?.digestLine, "preprint");
  assert.deepEqual(keywordFallbackTaggingStats(2), {
    llmClassified: 0,
    llmTagged: 0,
    fallback: 2,
  });
});
