import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { createChatCompletionWithJsonResponseFormatFallback } from "../../src/llm/createChatCompletionWithJsonResponseFormatFallback.js";
import { resetLlmRequestTimingForTests } from "../../src/llm/llmRequestTiming.js";

function fakeCompletion(id: string): ChatCompletion {
  return { id } as ChatCompletion;
}

function formatElapsed(_startedAt: number): string {
  return "0.0s";
}

const timingMeta = { gate: "test-gate", callSite: "testCallSite" } as const;

function assertTimingOkLog(message: string, label: string): void {
  assert.match(message, new RegExp(`^${label}: request ok · gate=test-gate callSite=testCallSite · duration=`));
  assert.match(message, /gap=/);
  assert.match(message, /~\d+ req\/60s$/);
}

function assertTimingFailedLog(message: string, label: string): void {
  assert.match(
    message,
    new RegExp(`^${label}: request failed · gate=test-gate callSite=testCallSite · duration=`),
  );
  assert.match(message, /gap=/);
  assert.match(message, /~\d+ req\/60s$/);
}

test("JSON-mode first request succeeds: one create call", async () => {
  resetLlmRequestTimingForTests();
  const calls: boolean[] = [];
  const logs: string[] = [];
  const completion = fakeCompletion("ok");

  const result = await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: true,
    create: async (useJson) => {
      calls.push(useJson);
      return completion;
    },
    log: (message) => logs.push(message),
    label: "batch-1",
    formatElapsed,
    timingMeta,
  });

  assert.deepEqual(calls, [true]);
  assert.equal(result.completion, completion);
  assert.equal(result.usedJsonResponseFormat, true);
  assert.ok(result.elapsedMs >= 0);
  assert.equal(logs.length, 2);
  assertTimingOkLog(logs[0]!, "batch-1");
  assert.equal(logs[1], "batch-1: HTTP ok in 0.0s");
});

test("JSON-mode first request fails: second create omits response_format", async () => {
  resetLlmRequestTimingForTests();
  const calls: boolean[] = [];
  const logs: string[] = [];
  const fallback = fakeCompletion("fallback");

  const result = await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: true,
    create: async (useJson) => {
      calls.push(useJson);
      if (useJson) throw new Error("json_object unsupported");
      return fallback;
    },
    log: (message) => logs.push(message),
    label: "batch-1",
    formatElapsed,
    timingMeta,
  });

  assert.deepEqual(calls, [true, false]);
  assert.equal(result.completion, fallback);
  assert.equal(result.usedJsonResponseFormat, false);
  assert.equal(logs.length, 4);
  assertTimingFailedLog(logs[0]!, "batch-1");
  assert.equal(logs[1], "batch-1: json_object mode failed, retrying without response_format…");
  assertTimingOkLog(logs[2]!, "batch-1");
  assert.equal(logs[3], "batch-1: HTTP ok in 0.0s");
});

test("custom jsonModeFailedRetryMessage preserves digest wording", async () => {
  resetLlmRequestTimingForTests();
  const logs: string[] = [];

  await createChatCompletionWithJsonResponseFormatFallback({
    preferJsonResponseFormat: true,
    create: async (useJson) => {
      if (useJson) throw new Error("json_object unsupported");
      return fakeCompletion("fallback");
    },
    log: (message) => logs.push(message),
    label: "digest-tag",
    formatElapsed,
    timingMeta,
    jsonModeFailedRetryMessage: "digest-tag: json_object failed, retrying without response_format…",
  });

  assert.equal(logs[1], "digest-tag: json_object failed, retrying without response_format…");
});

test("JSON mode disabled and request fails: no fallback create; error propagates", async () => {
  resetLlmRequestTimingForTests();
  const calls: boolean[] = [];
  const logs: string[] = [];
  const failure = new Error("upstream down");

  await assert.rejects(
    () =>
      createChatCompletionWithJsonResponseFormatFallback({
        preferJsonResponseFormat: false,
        create: async (useJson) => {
          calls.push(useJson);
          throw failure;
        },
        log: (message) => logs.push(message),
        label: "batch-1",
        formatElapsed,
        timingMeta,
      }),
    (error: unknown) => error === failure,
  );

  assert.deepEqual(calls, [false]);
  assert.equal(logs.length, 2);
  assertTimingFailedLog(logs[0]!, "batch-1");
  assert.equal(logs[1], "batch-1: failed after 0.0s");
});

test("fallback request fails: error propagates without swallowing", async () => {
  resetLlmRequestTimingForTests();
  const calls: boolean[] = [];
  const logs: string[] = [];
  const failure = new Error("fallback also failed");

  await assert.rejects(
    () =>
      createChatCompletionWithJsonResponseFormatFallback({
        preferJsonResponseFormat: true,
        create: async (useJson) => {
          calls.push(useJson);
          throw useJson ? new Error("json_object unsupported") : failure;
        },
        log: (message) => logs.push(message),
        label: "batch-1",
        formatElapsed,
        timingMeta,
      }),
    (error: unknown) => error === failure,
  );

  assert.deepEqual(calls, [true, false]);
  assert.equal(logs.length, 3);
  assertTimingFailedLog(logs[0]!, "batch-1");
  assert.equal(logs[1], "batch-1: json_object mode failed, retrying without response_format…");
  assertTimingFailedLog(logs[2]!, "batch-1");
});
