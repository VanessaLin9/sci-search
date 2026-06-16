import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { ROUTING_SYSTEM_PROMPT } from "../../src/domain/life-science/prompts/routing.system.js";
import { mergeBroadScienceRoutingResults } from "../../src/domain/life-science/routing/route.js";
import { classifyBroadSciencePapers } from "../../src/routing/classifyBroadScience.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import type { BroadScienceRoutingInput } from "../../src/routing/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

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

    return new Response(
      JSON.stringify(
        chatCompletion("This is prose, not JSON.", 24),
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

function installRoutingFetchWithHttpError(status: number, message: string): void {
  routingCallCount = 0;
  resetRoutingLlmClientCache();

  globalThis.fetch = (async (input) => {
    routingCallCount += 1;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    return new Response(message, { status, headers: { "content-type": "text/plain" } });
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

    const verdictById = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get("a"), "yes");
    assert.equal(verdictById.get("b"), "yes");
    assert.equal(verdictById.get("c"), "yes");
    assert.equal(verdictById.get("d"), "yes");
  });

  test("falls back to no when retry still misses verdicts", async () => {
    const missingId = "10.1038/d41586-026-01689-0";
    const items = [paper("a"), paper("b"), paper(missingId), paper("d")];
    installRoutingFetch([{ omitIds: [missingId] }, { omitIds: [missingId] }]);

    const verdictById = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get(missingId), "no");
    assert.equal(verdictById.get("a"), "yes");

    const merge = mergeBroadScienceRoutingResults(
      items.map((item) => ({ id: item.id, sourceId: item.source_id })),
      verdictById,
    );
    assert.equal(merge.excluded.length, 1);
    assert.equal(merge.excluded[0]?.paper.id, missingId);
  });

  test("does not overwrite context paper verdicts from the first successful batch", async () => {
    const items = [paper("a"), paper("b"), paper("c"), paper("d")];
    installRoutingFetch([{ omitIds: ["c"] }, { omitIds: ["d"] }]);

    const verdictById = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get("c"), "yes");
    assert.equal(verdictById.get("d"), "yes");
  });

  test("falls back to no when missing-retry request fails", async () => {
    const missingId = "10.1038/d41586-026-01689-0";
    const items = [paper("a"), paper("b"), paper(missingId), paper("d")];
    installRoutingFetchWithRetryFailure(
      { omitIds: [missingId] },
      new Error("Request timed out."),
    );

    const verdictById = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 2);
    assert.equal(verdictById.get(missingId), "no");
    assert.equal(verdictById.get("d"), "yes");
  });

  test("does not retry more than once for persistent missing verdicts", async () => {
    const items = [paper("a"), paper("b"), paper("c")];
    installRoutingFetch([{ omitIds: ["b"] }, { omitIds: ["b"] }, { omitIds: ["b"] }]);

    const verdictById = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get("b"), "no");
  });

  test("split retries on batch request failure then succeeds", async () => {
    const items = [paper("a"), paper("b"), paper("c"), paper("d")];
    // SDK maxRetries=1 → two failed attempts before classifyBatch splits the batch.
    installRoutingFetchWithRequestFailures(2);

    const verdictById = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 4);
    assert.equal(verdictById.get("a"), "yes");
    assert.equal(verdictById.get("b"), "yes");
    assert.equal(verdictById.get("c"), "yes");
    assert.equal(verdictById.get("d"), "yes");
  });

  test("falls back to no when batch request keeps failing on a single paper", async () => {
    const items = [paper("a")];
    installRoutingFetchWithRequestFailures(2);

    const verdictById = await classifyBroadSciencePapers(items);

    assert.equal(routingCallCount, 2);
    assert.equal(verdictById.get("a"), "no");
  });

  test("falls back to no when single-paper response has invalid JSON", async () => {
    const items = [paper("a")];
    installRoutingFetchWithInvalidJson();

    const verdictById = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 1);
    assert.equal(verdictById.get("a"), "no");
  });

  test("falls back to no when single-paper HTTP returns non-timeout error", async () => {
    const items = [paper("a")];
    installRoutingFetchWithHttpError(429, "Rate limit exceeded");

    const verdictById = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 1);
    assert.equal(verdictById.get("a"), "no");
  });

  test("falls back to no for entire batch when JSON stays invalid after split", async () => {
    const items = [paper("a"), paper("b")];
    installRoutingFetchWithInvalidJson();

    const verdictById = await classifyBroadSciencePapers(items);

    assert.ok(routingCallCount >= 2);
    assert.equal(verdictById.get("a"), "no");
    assert.equal(verdictById.get("b"), "no");
  });
});
