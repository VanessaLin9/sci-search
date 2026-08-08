import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { callDigestChatCompletion } from "../../src/digest/callDigestChat.js";
import type { DigestLlmConfig } from "../../src/digest/config.js";
import { resetDigestLlmClientCache } from "../../src/digest/digestLlmClient.js";
import { buildDigestSummarizeCompletionParams } from "../../src/digest/summarizePrompt.js";
import type { DigestSummarizeInput } from "../../src/digest/types.js";
import { resolveLlmQuotaTarget } from "../../src/llm/llmQuotaBucket.js";
import {
  GEMINI_MIN_START_INTERVAL_MS,
  NVIDIA_MIN_START_INTERVAL_MS,
} from "../../src/llm/llmRequestScheduler.js";
import {
  installLlmRateLimitTestHarness,
  resetLlmRateLimitTestHarness,
} from "../../src/llm/llmTransportRateLimit.js";
import { callRoutingCompletion } from "../../src/routing/callRoutingCompletion.js";
import type { RoutingLlmConfig } from "../../src/routing/config.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import { createFakeClock } from "../routing/helpers/fakeClock.js";

function chatCompletion(content = '{"ok":true}'): ChatCompletion {
  return {
    id: "chatcmpl-rate-limit",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function nvidiaRoutingConfig(apiKey = "shared-nvidia-key-zzzz"): RoutingLlmConfig {
  return {
    apiKey,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "test-model",
    maxPapersPerBatch: 40,
    maxInputTokens: 28000,
    timeoutMs: 5_000,
    maxTokens: 256,
    maxRetries: 0,
    preferJsonResponseFormat: false,
    disableThinking: true,
  };
}

function digestConfig(options: {
  apiKey: string;
  baseUrl: string;
  preferJsonResponseFormat?: boolean;
}): DigestLlmConfig {
  return {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: "test-model",
    maxFeatured: 12,
    overflowShowTitleZh: true,
    maxPapersPerBatch: 8,
    maxInputTokens: 28000,
    timeoutMs: 5_000,
    maxTokens: 256,
    maxRetries: 0,
    summarizeTimeoutMs: 5_000,
    summarizeFallbackTimeoutMs: 5_000,
    summarizeStageBudgetMs: 60_000,
    summarizeMaxRetries: 0,
    summarizeConcurrency: 1,
    summarizeFallbackConcurrency: 1,
    preferJsonResponseFormat: options.preferJsonResponseFormat ?? false,
    disableThinking: true,
  };
}

function summarizeInput(id: string): DigestSummarizeInput {
  return {
    id,
    title: "t",
    journal: "j",
    source_id: "s",
    scope: "life-science-only",
    digest_line: "line-a",
    abstract: "a",
  };
}

describe("llmTransportRateLimit integration", { concurrency: false }, () => {
  let originalFetch: typeof fetch;
  let originalConsoleLog: typeof console.log;

  before(() => {
    originalFetch = globalThis.fetch;
    originalConsoleLog = console.log;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    resetLlmRateLimitTestHarness();
    resetRoutingLlmClientCache();
    resetDigestLlmClientCache();
  });

  test("routing attempts on same NVIDIA key are start-spaced by 2s", async () => {
    const clock = createFakeClock(1_000_000);
    installLlmRateLimitTestHarness({ useProviderPolicies: true, clock });
    resetRoutingLlmClientCache();

    const starts: number[] = [];
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(chatCompletion('{"results":[]}')), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const config = nvidiaRoutingConfig();
    const paper = {
      id: "p1",
      title: "t",
      journal: "j",
      source_id: "s",
    };

    await Promise.all([
      callRoutingCompletion([paper], config, {
        label: "r1",
        onRequestAttempt: () => starts.push(clock.now()),
      }),
      callRoutingCompletion([paper], config, {
        label: "r2",
        onRequestAttempt: () => starts.push(clock.now()),
      }),
    ]);

    assert.equal(starts.length, 2);
    assert.ok(starts[1]! - starts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
    assert.ok(clock.sleeps.includes(NVIDIA_MIN_START_INTERVAL_MS));
  });

  test("routing + digest clients with same NVIDIA key share one bucket", async () => {
    const clock = createFakeClock(1_000_000);
    installLlmRateLimitTestHarness({ useProviderPolicies: true, clock });
    resetRoutingLlmClientCache();
    resetDigestLlmClientCache();

    const starts: number[] = [];
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(chatCompletion('{"ok":true}')), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const key = "shared-nvidia-key-zzzz";
    const routing = nvidiaRoutingConfig(key);
    const digest = digestConfig({
      apiKey: key,
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });
    assert.equal(
      resolveLlmQuotaTarget(routing.baseUrl, routing.apiKey).bucket,
      resolveLlmQuotaTarget(digest.baseUrl, digest.apiKey).bucket,
    );

    await Promise.all([
      callRoutingCompletion(
        [{ id: "p1", title: "t", journal: "j", source_id: "s" }],
        routing,
        {
          label: "routing",
          onRequestAttempt: () => starts.push(clock.now()),
        },
      ),
      callDigestChatCompletion(
        digest,
        (maxTokens, useJson) =>
          buildDigestSummarizeCompletionParams(summarizeInput("p1"), digest, useJson, maxTokens),
        {
          label: "digest",
          gate: "digest-summarize",
          estimatedCompletionTokens: 64,
          onRequestAttempt: () => starts.push(clock.now()),
        },
      ),
    ]);

    assert.equal(starts.length, 2);
    assert.ok(starts[1]! - starts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
  });

  test("Gemini digest attempts use 5s policy and do not block NVIDIA", async () => {
    const clock = createFakeClock(1_000_000);
    installLlmRateLimitTestHarness({ useProviderPolicies: true, clock });
    resetRoutingLlmClientCache();
    resetDigestLlmClientCache();

    const nvidiaStarts: number[] = [];
    const geminiStarts: number[] = [];
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(chatCompletion('{"ok":true}')), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const nvidia = nvidiaRoutingConfig("nvidia-only-key");
    const gemini = digestConfig({
      apiKey: "gemini-only-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      preferJsonResponseFormat: false,
    });

    const routingPaper = {
      id: "p1",
      title: "t",
      journal: "j",
      source_id: "s",
    };

    // First starts can share the same instant (independent buckets).
    await Promise.all([
      callRoutingCompletion([routingPaper], nvidia, {
        label: "n1",
        onRequestAttempt: () => nvidiaStarts.push(clock.now()),
      }),
      callDigestChatCompletion(
        gemini,
        (maxTokens, useJson) =>
          buildDigestSummarizeCompletionParams(summarizeInput("p1"), gemini, useJson, maxTokens),
        {
          label: "g1",
          gate: "digest-summarize",
          estimatedCompletionTokens: 64,
          onRequestAttempt: () => geminiStarts.push(clock.now()),
        },
      ),
    ]);
    assert.equal(nvidiaStarts[0], geminiStarts[0]);

    await Promise.all([
      callRoutingCompletion([routingPaper], nvidia, {
        label: "n2",
        onRequestAttempt: () => nvidiaStarts.push(clock.now()),
      }),
      callDigestChatCompletion(
        gemini,
        (maxTokens, useJson) =>
          buildDigestSummarizeCompletionParams(summarizeInput("p2"), gemini, useJson, maxTokens),
        {
          label: "g2",
          gate: "digest-summarize",
          estimatedCompletionTokens: 64,
          onRequestAttempt: () => geminiStarts.push(clock.now()),
        },
      ),
    ]);

    assert.equal(nvidiaStarts.length, 2);
    assert.equal(geminiStarts.length, 2);
    assert.ok(nvidiaStarts[1]! - nvidiaStarts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
    assert.ok(geminiStarts[1]! - geminiStarts[0]! >= GEMINI_MIN_START_INTERVAL_MS);
  });

  test("json_object fallback re-enters the scheduler for a second attempt", async () => {
    const clock = createFakeClock(1_000_000);
    installLlmRateLimitTestHarness({ useProviderPolicies: true, clock });
    resetDigestLlmClientCache();

    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    let calls = 0;
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: { type?: string };
      };
      if (body.response_format?.type === "json_object") {
        return new Response(JSON.stringify({ error: { message: "response_format unsupported" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(chatCompletion('{"ok":true}')), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const gemini = digestConfig({
      apiKey: "gemini-json-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      preferJsonResponseFormat: true,
    });

    await callDigestChatCompletion(
      gemini,
      (maxTokens, useJson) =>
        buildDigestSummarizeCompletionParams(summarizeInput("p1"), gemini, useJson, maxTokens),
      {
        label: "json-fallback",
        gate: "digest-summarize",
        estimatedCompletionTokens: 64,
      },
    );

    assert.equal(calls, 2);
    const permitLogs = logs.filter((line) => line.includes("rateLimit bucket="));
    assert.equal(permitLogs.length, 2);
    assert.ok(clock.sleeps.includes(GEMINI_MIN_START_INTERVAL_MS));
  });
});
