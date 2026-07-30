import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
  resetLlmRequestTimingForTests,
} from "../../src/llm/llmRequestTiming.js";

test("first request is marked first; later requests report gap and window count", () => {
  resetLlmRequestTimingForTests();

  const first = noteLlmRequestStart(1_000_000);
  assert.equal(first.gapSincePreviousStartMs, null);
  assert.equal(first.requestsInLastMinute, 1);
  assert.match(formatLlmRequestTimingSuffix(first, 1_000_500), /gap=first/);
  assert.match(formatLlmRequestTimingSuffix(first, 1_000_500), /~1 req\/60s/);

  const second = noteLlmRequestStart(1_001_200);
  assert.equal(second.gapSincePreviousStartMs, 1_200);
  assert.equal(second.requestsInLastMinute, 2);
  assert.match(formatLlmRequestTimingSuffix(second, 1_002_000), /gap=1\.2s/);
  assert.match(formatLlmRequestTimingSuffix(second, 1_002_000), /~2 req\/60s/);
});

test("requests older than 60s drop out of the rolling window", () => {
  resetLlmRequestTimingForTests();

  noteLlmRequestStart(1_000_000);
  const recent = noteLlmRequestStart(1_061_000);
  assert.equal(recent.requestsInLastMinute, 1);
});
