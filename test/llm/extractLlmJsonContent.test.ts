import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractLlmJsonContent,
  isRoutingBatchRequestFailure,
  isRoutingMissingVerdictsError,
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

test("shouldRetrySplitLlmBatch treats routing missing verdict errors as retryable", () => {
  const error = new Error("Routing LLM missing verdicts for: 10.1038/d41586-026-01689-0");
  assert.equal(shouldRetrySplitLlmBatch(error, "stop"), true);
  assert.equal(isRoutingMissingVerdictsError(error), true);
});

test("isRoutingBatchRequestFailure detects timeout and connection errors", () => {
  const timeout = Object.assign(new Error("Request timed out."), {
    name: "APIConnectionTimeoutError",
  });
  assert.equal(isRoutingBatchRequestFailure(timeout), true);
  assert.equal(isRoutingBatchRequestFailure(new Error("Connection error.")), true);
  assert.equal(isRoutingBatchRequestFailure(new Error("invalid JSON")), false);
});
