import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractLlmJsonContent,
  shouldRetrySplitLlmBatch,
} from "../../src/llm/extractLlmJsonContent.js";

test("extractLlmJsonContent prefers JSON in content", () => {
  const result = extractLlmJsonContent({
    content: '{"results":[{"id":"p1","verdict":"yes"}]}',
  });
  assert.equal(result.usedReasoningFallback, false);
  assert.equal(result.content, '{"results":[{"id":"p1","verdict":"yes"}]}');
});

test("extractLlmJsonContent extracts JSON from reasoning when content is empty", () => {
  const result = extractLlmJsonContent({
    content: "",
    reasoning_content:
      'Let me classify each paper.\n{"results":[{"id":"p1","verdict":"no"}]}',
  });
  assert.equal(result.usedReasoningFallback, true);
  assert.equal(result.content, '{"results":[{"id":"p1","verdict":"no"}]}');
});

test("extractLlmJsonContent rejects reasoning-only prose without JSON", () => {
  assert.throws(
    () =>
      extractLlmJsonContent({
        content: "",
        reasoning_content: "Let me go through each paper and determine if it belongs to life sciences.",
      }),
    /reasoning only with no JSON/,
  );
});

test("shouldRetrySplitLlmBatch retries on length and missing JSON", () => {
  assert.equal(shouldRetrySplitLlmBatch(new Error("x"), "length"), true);
  assert.equal(
    shouldRetrySplitLlmBatch(new Error("LLM put output in reasoning only with no JSON"), "stop"),
    true,
  );
  assert.equal(shouldRetrySplitLlmBatch(new Error("network timeout"), "stop"), false);
});
