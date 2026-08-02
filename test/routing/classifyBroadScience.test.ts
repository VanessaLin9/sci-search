import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { ROUTING_SYSTEM_PROMPT } from "../../src/domain/life-science/prompts/routing.system.js";
import { classifyBroadSciencePapers } from "../../src/routing/classifyBroadScience.js";
import { DEFAULT_RATE_LIMIT_WAIT_MS, SERVER_ERROR_BACKOFF_MS } from "../../src/routing/routingRetryPolicy.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import type { BroadScienceRoutingInput } from "../../src/routing/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";
import { createFakeClock } from "./helpers/fakeClock.js";

type RoutingMockPlan = {
  omitIds?: string[];
};

function paper(id: string): BroadScienceRoutingInput {
  return { id, title: `Title ${id}`, journal: "Test", source_id: "science" };
}

function chatCompletion(content: string, completionTokens = 24): ChatCompletion {
  return {
    id: "chatcmpl-test",
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
    usage: { prompt_tokens: 12, completion_tokens: completionTokens, total_tokens: 36 },
  };
}

function routingResponse(papers: Array<{ id: string }>, plan: RoutingMockPlan = {}): Response {
  const omit = new Set(plan.omitIds ?? []);
  const results = papers
    .filter((item) => !omit.has(item.id))
    .map((item) => ({ id: item.id, verdict: "yes" as const }));
  return new Response(JSON.stringify(chatCompletion(JSON.stringify({ results }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createRoutingMockFetch(plans: RoutingMockPlan[]): typeof fetch {
  let callIndex = 0;

  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? await new Response(init.body).text()
          : "";
    const request = JSON.parse(body) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const system = request.messages?.find((message) => message.role === "system")?.content ?? "";
    if (!system.includes(ROUTING_SYSTEM_PROMPT.slice(0, 40))) {
      throw new Error("Not a routing completion request");
    }

    const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
    const payloadStart = user.indexOf("{");
    const payload = JSON.parse(user.slice(payloadStart)) as {
      papers: Array<{ id: string }>;
    };
    const plan = plans[callIndex] ?? plans[plans.length - 1] ?? {};
    callIndex += 1;
    return routingResponse(payload.papers, plan);
  };
}

let originalFetch: typeof fetch;
let routingCallCount = 0;

function installRoutingFetch(plans: RoutingMockPlan[]): void {
  routingCallCount = 0;
  resetRoutingLlmClientCache();
  const baseFetch = createRoutingMockFetch(plans);
  globalThis.fetch = (async (...args) => {
    routingCallCount += 1;
    return baseFetch(...args);
  }) as typeof fetch;
}

function installRoutingFetchWithRequestFailures(
  failuresBeforeSuccess: number,
  error: Error = new Error("Request timed out."),
): void {
  routingCallCount = 0;
  resetRoutingLlmClientCache();
  let failuresLeft = failuresBeforeSuccess;

  globalThis.fetch = (async (input, init) => {
    routingCallCount += 1;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw error;
    }

    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? await new Response(init.body).text()
          : "";
    const request = JSON.parse(body) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
    const payloadStart = user.indexOf("{");
    const payload = JSON.parse(user.slice(payloadStart)) as {
      papers: Array<{ id: string }>;
    };
    return routingResponse(payload.papers);
  }) as typeof fetch;
}

function installRoutingFetchWithInvalidJson(): void {
  routingCallCount = 0;
  resetRoutingLlmClientCache();

  globalThis.fetch = (async (input) => {
    routingCallCount += 1;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    return new Response(JSON.stringify(chatCompletion("This is prose, not JSON.", 24)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function installRoutingFetchWithHttpError(
  status: number,
  message: string,
  headers?: Record<string, string>,
): void {
  routingCallCount = 0;
  resetRoutingLlmClientCache();

  globalThis.fetch = (async (input) => {
    routingCallCount += 1;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    return new Response(message, {
      status,
      headers: { "content-type": "text/plain", ...headers },
    });
  }) as typeof fetch;
}

function installRoutingFetchWithRetryFailure(firstPlan: RoutingMockPlan, retryError: Error): void {
  routingCallCount = 0;
  resetRoutingLlmClientCache();
  let firstCallDone = false;

  globalThis.fetch = (async (input, init) => {
    routingCallCount += 1;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    if (firstCallDone) {
      throw retryError;
    }

    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? await new Response(init.body).text()
          : "";
    const request = JSON.parse(body) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
    const payloadStart = user.indexOf("{");
    const payload = JSON.parse(user.slice(payloadStart)) as {
      papers: Array<{ id: string }>;
    };
    firstCallDone = true;
    return routingResponse(payload.papers, firstPlan);
  }) as typeof fetch;
}

before(() => {
  installPipelineTestEnv();
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("classifyBroadSciencePapers missing verdict handling", { concurrency: 1 }, () => {
  test("retries missing verdict batch once then succeeds", async () => {
    const items = [paper("a"), paper("b"), paper("c"), paper("d")];
    installRoutingFetch([{ omitIds: ["c"] }, {}]);

    const { verdictById } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get("a"), "yes");
    assert.equal(verdictById.get("b"), "yes");
    assert.equal(verdictById.get("c"), "yes");
    assert.equal(verdictById.get("d"), "yes");
  });

  test("marks papers degraded when retry still misses verdicts", async () => {
    const missingId = "10.1038/d41586-026-01689-0";
    const items = [paper("a"), paper("b"), paper(missingId), paper("d")];
    installRoutingFetch([{ omitIds: [missingId] }, { omitIds: [missingId] }]);

    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.ok(degradedPaperIds.includes(missingId));
    assert.equal(verdictById.get(missingId), undefined);
    assert.equal(verdictById.get("a"), "yes");
  });

  test("does not overwrite context paper verdicts from the first successful batch", async () => {
    const items = [paper("a"), paper("b"), paper("c"), paper("d")];
    installRoutingFetch([{ omitIds: ["c"] }, { omitIds: ["d"] }]);

    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get("c"), "yes");
    assert.equal(verdictById.get("d"), "yes");
    assert.ok(!degradedPaperIds.includes("d"), "context paper d must not be degraded when retry omits it");
    assert.ok(!degradedPaperIds.includes("a"));
    assert.ok(!degradedPaperIds.includes("b"));
  });

  test("marks papers degraded when missing-retry request fails", async () => {
    const missingId = "10.1038/d41586-026-01689-0";
    const items = [paper("a"), paper("b"), paper(missingId), paper("d")];
    installRoutingFetchWithRetryFailure(
      { omitIds: [missingId] },
      new Error("Request timed out."),
    );

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 2);
    assert.ok(degradedPaperIds.includes(missingId));
    assert.equal(verdictById.get(missingId), undefined);
    assert.equal(verdictById.get("d"), "yes");
    assert.equal(diagnostics.stopReason, "timeout");
  });

  test("does not retry more than once for persistent missing verdicts", async () => {
    const items = [paper("a"), paper("b"), paper("c")];
    installRoutingFetch([{ omitIds: ["b"] }, { omitIds: ["b"] }, { omitIds: ["b"] }]);

    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.ok(degradedPaperIds.includes("b"));
    assert.equal(verdictById.get("b"), undefined);
  });

  test("timeout does not split and stops further provider calls", async () => {
    const items = [paper("a"), paper("b"), paper("c"), paper("d")];
    installRoutingFetchWithRequestFailures(99);

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 1);
    assert.equal(diagnostics.requestCount, 1);
    assert.equal(diagnostics.timeoutCount, 1);
    assert.equal(diagnostics.stopReason, "timeout");
    assert.deepEqual(degradedPaperIds.sort(), ["a", "b", "c", "d"]);
    assert.equal(verdictById.size, 0);
  });

  test("marks single paper degraded on first timeout with sdk maxRetries=0", async () => {
    const items = [paper("a")];
    installRoutingFetchWithRequestFailures(99);

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 1);
    assert.equal(diagnostics.requestCount, 1);
    assert.deepEqual(degradedPaperIds, ["a"]);
    assert.equal(verdictById.get("a"), undefined);
  });

  test("preserves first-batch LLM verdicts when a later batch times out", async () => {
    const batch1 = Array.from({ length: 40 }, (_, i) => paper(`p${i}`));
    const batch2 = Array.from({ length: 10 }, (_, i) => paper(`q${i}`));
    const items = [...batch1, ...batch2];

    routingCallCount = 0;
    resetRoutingLlmClientCache();
    let callIndex = 0;
    globalThis.fetch = (async (input, init) => {
      routingCallCount += 1;
      callIndex += 1;
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      if (callIndex === 1) {
        const body =
          typeof init?.body === "string"
            ? init.body
            : init?.body
              ? await new Response(init.body).text()
              : "";
        const request = JSON.parse(body) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
        const payload = JSON.parse(user.slice(user.indexOf("{"))) as {
          papers: Array<{ id: string }>;
        };
        return routingResponse(payload.papers);
      }
      throw new Error("Request timed out.");
    }) as typeof fetch;

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(diagnostics.stopReason, "timeout");
    assert.equal(verdictById.size, 40);
    assert.equal(degradedPaperIds.length, 10);
    for (const item of batch1) {
      assert.equal(verdictById.get(item.id), "yes");
    }
    for (const item of batch2) {
      assert.ok(degradedPaperIds.includes(item.id));
    }
  });

  test("marks single paper degraded when response has invalid JSON", async () => {
    const items = [paper("a")];
    installRoutingFetchWithInvalidJson();

    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 1);
    assert.deepEqual(degradedPaperIds, ["a"]);
    assert.equal(verdictById.get("a"), undefined);
  });

  test("429 waits for Retry-After then retries once successfully", async () => {
    const clock = createFakeClock();
    const items = [paper("a")];
    let call = 0;
    routingCallCount = 0;
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
      routingCallCount += 1;
      call += 1;
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) throw new Error(`Unexpected fetch: ${url}`);
      if (call === 1) {
        return new Response("Rate limit exceeded", {
          status: 429,
          headers: { "content-type": "text/plain", "retry-after": "5" },
        });
      }
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body
            ? await new Response(init.body).text()
            : "";
      const request = JSON.parse(body) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
      const payload = JSON.parse(user.slice(user.indexOf("{"))) as { papers: Array<{ id: string }> };
      return routingResponse(payload.papers);
    }) as typeof fetch;

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items, {
      clock,
      jitterMs: () => 0,
    });

    assert.equal(routingCallCount, 2);
    assert.deepEqual(clock.sleeps, [5_000]);
    assert.equal(verdictById.get("a"), "yes");
    assert.deepEqual(degradedPaperIds, []);
    assert.equal(diagnostics.rateLimitCount, 1);
    assert.equal(diagnostics.stopReason, null);
  });

  test("429 without hint uses default backoff + jitter and stops after persistent 429", async () => {
    const clock = createFakeClock();
    const items = [paper("a")];
    installRoutingFetchWithHttpError(429, "Rate limit exceeded");

    const { degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items, {
      clock,
      jitterMs: () => 100,
    });

    assert.equal(routingCallCount, 2);
    assert.deepEqual(clock.sleeps, [DEFAULT_RATE_LIMIT_WAIT_MS + 100]);
    assert.deepEqual(degradedPaperIds, ["a"]);
    assert.equal(diagnostics.stopReason, "persistent_rate_limit");
    assert.equal(diagnostics.rateLimitCount, 2);
  });

  test("429 skips sleep when remaining budget cannot cover wait + request", async () => {
    const clock = createFakeClock();
    const items = [paper("a")];
    installRoutingFetchWithHttpError(429, "Rate limit exceeded", { "retry-after": "30" });

    const { degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items, {
      clock,
      budgetMs: 5_000,
      jitterMs: () => 0,
    });

    assert.equal(routingCallCount, 1);
    assert.deepEqual(clock.sleeps, []);
    assert.deepEqual(degradedPaperIds, ["a"]);
    assert.equal(diagnostics.stopReason, "persistent_rate_limit");
  });

  test("5xx retries once after short backoff then succeeds", async () => {
    const clock = createFakeClock();
    const items = [paper("a")];
    let call = 0;
    routingCallCount = 0;
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
      routingCallCount += 1;
      call += 1;
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) throw new Error(`Unexpected fetch: ${url}`);
      if (call === 1) {
        return new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
      }
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body
            ? await new Response(init.body).text()
            : "";
      const request = JSON.parse(body) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
      const payload = JSON.parse(user.slice(user.indexOf("{"))) as { papers: Array<{ id: string }> };
      return routingResponse(payload.papers);
    }) as typeof fetch;

    const { verdictById, diagnostics } = await classifyBroadSciencePapers(items, {
      clock,
      jitterMs: () => 0,
    });

    assert.equal(routingCallCount, 2);
    assert.deepEqual(clock.sleeps, [SERVER_ERROR_BACKOFF_MS]);
    assert.equal(verdictById.get("a"), "yes");
    assert.equal(diagnostics.serverErrorCount, 1);
    assert.equal(diagnostics.stopReason, null);
  });

  test("5xx stops further calls after retry still fails", async () => {
    const clock = createFakeClock();
    const items = [paper("a"), paper("b")];
    // Force two top-level batches of 1 by using maxPapers from config (40) — use two sequential
    // timeouts via always-503: first paper batch may be size 2 in one batch.
    installRoutingFetchWithHttpError(503, "unavailable");

    const { degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items, {
      clock,
      jitterMs: () => 0,
    });

    assert.equal(routingCallCount, 2);
    assert.equal(diagnostics.stopReason, "persistent_5xx");
    assert.deepEqual(degradedPaperIds.sort(), ["a", "b"]);
  });

  test("marks entire batch degraded when JSON stays invalid after split", async () => {
    const items = [paper("a"), paper("b")];
    installRoutingFetchWithInvalidJson();

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 2);
    assert.ok(diagnostics.parseFailureCount >= 1);
    assert.deepEqual(degradedPaperIds.sort(), ["a", "b"]);
    assert.equal(verdictById.get("a"), undefined);
    assert.equal(verdictById.get("b"), undefined);
  });

  test("budget exhausted skips later batches without more provider calls", async () => {
    const clock = createFakeClock();
    const batch1 = Array.from({ length: 40 }, (_, i) => paper(`p${i}`));
    const batch2 = Array.from({ length: 5 }, (_, i) => paper(`q${i}`));
    const items = [...batch1, ...batch2];

    routingCallCount = 0;
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
      routingCallCount += 1;
      // Consume almost all budget during the first request.
      clock.advance(4_500);
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body
            ? await new Response(init.body).text()
            : "";
      const request = JSON.parse(body) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
      const payload = JSON.parse(user.slice(user.indexOf("{"))) as { papers: Array<{ id: string }> };
      return routingResponse(payload.papers);
    }) as typeof fetch;

    const { verdictById, degradedPaperIds, diagnostics } = await classifyBroadSciencePapers(items, {
      clock,
      budgetMs: 5_000,
      jitterMs: () => 0,
    });

    assert.equal(routingCallCount, 1);
    assert.equal(diagnostics.requestCount, 1);
    assert.equal(diagnostics.stopReason, "budget_exhausted");
    assert.equal(verdictById.size, 40);
    assert.equal(degradedPaperIds.length, 5);
  });

  test("every paper ends in LLM verdict or keyword-fallback degrade, never both", async () => {
    const items = [paper("a"), paper("b"), paper("c")];
    installRoutingFetch([{ omitIds: ["b"] }, { omitIds: ["b"] }]);

    const { verdictById, degradedPaperIds } = await classifyBroadSciencePapers(items);
    const allIds = items.map((item) => item.id);
    for (const id of allIds) {
      const inLlm = verdictById.has(id);
      const inDegraded = degradedPaperIds.includes(id);
      assert.equal(inLlm || inDegraded, true, `${id} unresolved`);
      assert.equal(inLlm && inDegraded, false, `${id} in both`);
    }
  });

  test("logs clipped request timeout from remaining budget", async () => {
    const clock = createFakeClock();
    const items = [paper("a")];
    installRoutingFetch([{}]);
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = ((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }) as typeof console.log;

    try {
      await classifyBroadSciencePapers(items, { clock, budgetMs: 12_345, jitterMs: () => 0 });
    } finally {
      console.log = originalLog;
    }

    assert.ok(lines.some((line) => line.includes("timeout=12345ms")));
  });
});
