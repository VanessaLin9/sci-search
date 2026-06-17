import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { buildSourceScopeById } from "../../src/domain/life-science/routing/sourceScope.js";
import { routeLifeSciencePapers } from "../../src/routing/routeLifeScience.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import type { Paper } from "../../src/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

const scopeBySourceId = buildSourceScopeById([
  { id: "nature-methods", scope: "life-science-only" },
  { id: "science", scope: "broad-science" },
]);

function makePaper(id: string, sourceId: string, title?: string): Paper {
  return {
    id,
    title: title ?? `Title ${id}`,
    journal: "Test Journal",
    publishedDate: "2026-06-10",
    url: `https://example.test/${id}`,
    sourceId,
  };
}

function chatCompletion(content: string): ChatCompletion {
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
    usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
  };
}

function installRoutingYesFetch(): void {
  resetRoutingLlmClientCache();
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify(
        chatCompletion(
          JSON.stringify({
            results: [{ id: "bs-1", verdict: "yes" }],
          }),
        ),
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

function installRoutingHttpError(status: number, message: string): void {
  resetRoutingLlmClientCache();
  globalThis.fetch = (async () => {
    return new Response(message, { status, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
}

function installRoutingInvalidJson(): void {
  resetRoutingLlmClientCache();
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify(chatCompletion("not json")),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

function installRoutingRequestTimeout(): void {
  resetRoutingLlmClientCache();
  globalThis.fetch = (async () => {
    throw new Error("Request timed out.");
  }) as typeof fetch;
}

let originalFetch: typeof fetch;
let logLines: string[] = [];
let originalLog: typeof console.log;

before(() => {
  originalFetch = globalThis.fetch;
  originalLog = console.log;
});

after(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
});

function installTestEnv(): void {
  installPipelineTestEnv();
  logLines = [];
  console.log = ((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  }) as typeof console.log;
}

describe("routeLifeSciencePapers gate boundary", { concurrency: 1 }, () => {
  test("returns scope-default included plus LLM yes for broad-science on success", async () => {
    installTestEnv();
    installRoutingYesFetch();

    const result = await routeLifeSciencePapers({
      papers: [makePaper("ls-1", "nature-methods"), makePaper("bs-1", "science")],
      scopeBySourceId,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.included.length, 2);
    assert.equal(result.excluded.length, 0);
    assert.equal(result.included[0]?.lifeScienceRouting?.method, "scope-default");
    assert.equal(result.included[1]?.lifeScienceRouting?.method, "llm");
    assert.equal(result.included[1]?.lifeScienceRouting?.verdict, "yes");
  });

  test("gate degrades when routing API key is missing", async () => {
    installTestEnv();
    delete process.env.ROUTING_LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await routeLifeSciencePapers({
      papers: [makePaper("ls-1", "nature-methods"), makePaper("bs-1", "science")],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 1);
    assert.equal(result.included[0]?.id, "ls-1");
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0]?.paper.id, "bs-1");
    assert.equal(result.excluded[0]?.method, "routing-keyword-fallback");
    assert.equal(result.stats.keywordFallbackNo, 1);
    assert.equal(result.stats.llmNo, 0);
    assert.ok(logLines.some((line) => line.includes("routing gate degraded")));
    assert.ok(logLines.some((line) => line.includes("routing keyword fallback")));
  });

  test("gate degrades when ROUTING_LLM_MODEL is missing", async () => {
    installTestEnv();
    delete process.env.ROUTING_LLM_MODEL;

    const result = await routeLifeSciencePapers({
      papers: [makePaper("bs-1", "science")],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 0);
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0]?.method, "routing-keyword-fallback");
    assert.equal(result.stats.keywordFallbackNo, 1);
    assert.ok(logLines.some((line) => line.includes("routing gate degraded")));
  });

  test("classifier degrade uses keyword fallback: HTTP 429", async () => {
    installTestEnv();
    installRoutingHttpError(429, "Rate limit exceeded");

    const result = await routeLifeSciencePapers({
      papers: [makePaper("ls-1", "nature-methods"), makePaper("bs-1", "science")],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 1);
    assert.equal(result.included[0]?.id, "ls-1");
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0]?.paper.id, "bs-1");
    assert.equal(result.excluded[0]?.method, "routing-keyword-fallback");
    assert.equal(result.stats.keywordFallbackNo, 1);
    assert.equal(result.stats.llmNo, 0);
  });

  test("classifier degrade uses keyword fallback: invalid JSON → broad-science excluded", async () => {
    installTestEnv();
    installRoutingInvalidJson();

    const result = await routeLifeSciencePapers({
      papers: [makePaper("bs-a", "science"), makePaper("bs-b", "science")],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 0);
    assert.equal(result.excluded.length, 2);
    assert.equal(result.excluded[0]?.method, "routing-keyword-fallback");
    assert.equal(result.stats.keywordFallbackNo, 2);
    assert.deepEqual(
      result.excluded.map((entry) => entry.paper.id).sort(),
      ["bs-a", "bs-b"],
    );
  });

  test("classifier degrade uses keyword fallback: request timeout", async () => {
    installTestEnv();
    installRoutingRequestTimeout();

    const result = await routeLifeSciencePapers({
      papers: [makePaper("ls-1", "nature-methods"), makePaper("bs-1", "science")],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 1);
    assert.equal(result.included[0]?.id, "ls-1");
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0]?.paper.id, "bs-1");
    assert.equal(result.excluded[0]?.method, "routing-keyword-fallback");
    assert.equal(result.stats.keywordFallbackNo, 1);
  });

  test("keyword fallback includes likely life-science title on gate degrade", async () => {
    installTestEnv();
    delete process.env.ROUTING_LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await routeLifeSciencePapers({
      papers: [
        makePaper(
          "bs-ls",
          "science",
          "Semaglutide attenuates neuroinflammation in male mice",
        ),
      ],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 1);
    assert.equal(result.included[0]?.lifeScienceRouting?.method, "routing-keyword-fallback");
    assert.equal(result.included[0]?.lifeScienceRouting?.verdict, "yes");
    assert.equal(result.stats.keywordFallbackYes, 1);
    assert.equal(result.stats.keywordFallbackNo, 0);
  });

  test("life-science-only papers stay included when broad-science gate degrades", async () => {
    installTestEnv();
    delete process.env.ROUTING_LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await routeLifeSciencePapers({
      papers: [
        makePaper("ls-1", "nature-methods"),
        makePaper("ls-2", "nature-methods"),
        makePaper("bs-1", "science"),
        makePaper("bs-2", "science"),
      ],
      scopeBySourceId,
    });

    assert.equal(result.included.length, 2);
    assert.deepEqual(result.included.map((paper) => paper.id).sort(), ["ls-1", "ls-2"]);
    assert.equal(result.excluded.length, 2);
    assert.equal(result.stats.passedByScope, 2);
    assert.equal(result.stats.keywordFallbackNo, 2);
    assert.equal(result.stats.llmNo, 0);
  });
});
