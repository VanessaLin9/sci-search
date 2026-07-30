import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
  resetLlmRequestTimingForTests,
} from "../../src/llm/llmRequestTiming.js";

const meta = { gate: "life-science-routing", callSite: "callRoutingCompletion" } as const;

test("first request is marked first; later requests report gap and window count", () => {
  resetLlmRequestTimingForTests();

  const first = noteLlmRequestStart(1_000_000);
  assert.equal(first.gapSincePreviousStartMs, null);
  assert.equal(first.requestsInLastMinute, 1);
  const firstLine = formatLlmRequestTimingSuffix(first, meta, 1_000_500);
  assert.match(firstLine, /gate=life-science-routing callSite=callRoutingCompletion/);
  assert.match(firstLine, /gap=first/);
  assert.match(firstLine, /~1 req\/60s/);

  const second = noteLlmRequestStart(1_001_200);
  assert.equal(second.gapSincePreviousStartMs, 1_200);
  assert.equal(second.requestsInLastMinute, 2);
  const secondLine = formatLlmRequestTimingSuffix(second, meta, 1_002_000);
  assert.match(secondLine, /gap=1\.2s/);
  assert.match(secondLine, /~2 req\/60s/);
});

test("requests older than 60s drop out of the rolling window", () => {
  resetLlmRequestTimingForTests();

  noteLlmRequestStart(1_000_000);
  const recent = noteLlmRequestStart(1_061_000);
  assert.equal(recent.requestsInLastMinute, 1);
});
