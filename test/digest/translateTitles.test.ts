import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { DigestLlmConfig } from "../../src/digest/config.js";
import { resetDigestLlmClientCache } from "../../src/digest/digestLlmClient.js";
import { translateOverflowTitles } from "../../src/digest/translateTitles.js";
import type { ClassifiedPaper } from "../../src/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

type RequestRecord = {
  model: string;
  paperIds: string[];
  url: string;
  authorization: string;
};

function overflowPaper(id: string, overrides: Partial<ClassifiedPaper> = {}): ClassifiedPaper {
  return {
    id,
    title: `Title ${id}`,
    journal: "Test Journal",
    publishedDate: "2026-08-01",
    url: `https://example.test/${id}`,
    sourceId: "science",
    matchedKeywords: [],
    section: "other",
    digestLine: "line-b",
    featured: false,
    ...overrides,
  };
}

function digestConfig(overrides: Partial<DigestLlmConfig> = {}): DigestLlmConfig {
  return {
    apiKey: "test-digest-key",
    baseUrl: "https://api.example.test/v1",
    model: "primary-model",
    fallbackModel: "gemini-3.5-flash-lite",
    fallbackApiKey: "test-gemini-key",
    fallbackBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    fallbackPreferJsonResponseFormat: true,
    fallbackDisableThinking: false,
    maxFeatured: 12,
    overflowShowTitleZh: true,
    maxPapersPerBatch: 8,
    maxInputTokens: 28_000,
    timeoutMs: 5_000,
    maxTokens: 1_024,
    maxRetries: 0,
    summarizeTimeoutMs: 90_000,
    summarizeFallbackTimeoutMs: 240_000,
    summarizeStageBudgetMs: 900_000,
    summarizeMaxRetries: 0,
    summarizeConcurrency: 2,
    summarizeFallbackConcurrency: 2,
    preferJsonResponseFormat: false,
    disableThinking: false,
    ...overrides,
  };
}

function chatCompletion(content: string, model = "primary-model"): ChatCompletion {
  return {
    id: "chatcmpl-translate-test",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
  };
}

function successBody(ids: string[]): string {
  return JSON.stringify({
    results: ids.map((id) => ({ id, title_zh: `繁中標題 ${id}` })),
  });
}

function parseRequest(input: RequestInfo | URL, init?: RequestInit): RequestRecord {
  const body = typeof init?.body === "string" ? init.body : undefined;
  if (!body) throw new Error("missing chat completion body");
  const request = JSON.parse(body) as {
    model?: string;
    messages?: Array<{ role?: string; content?: string }>;
  };
  const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
  const payloadStart = user.indexOf("{");
  const payload = JSON.parse(user.slice(payloadStart)) as { papers: Array<{ id: string }> };
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers);
  return {
    model: request.model ?? "",
    paperIds: payload.papers.map((paper) => paper.id),
    url,
    authorization: headers.get("authorization") ?? "",
  };
}

type MockHandler = (request: RequestRecord, callIndex: number) => Response;

function installTranslateFetch(handler: MockHandler): { requests: RequestRecord[] } {
  const requests: RequestRecord[] = [];
  resetDigestLlmClientCache();
  let callIndex = 0;

  globalThis.fetch = (async (input, init) => {
    const request = parseRequest(input as RequestInfo | URL, init);
    requests.push(request);
    const index = callIndex;
    callIndex += 1;
    return handler(request, index);
  }) as typeof fetch;

  return { requests };
}

function jsonOk(ids: string[], model: string): Response {
  return new Response(JSON.stringify(chatCompletion(successBody(ids), model)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function httpError(status: number): Response {
  return new Response("upstream failed", {
    status,
    headers: { "content-type": "text/plain" },
  });
}

let originalFetch: typeof fetch;

before(() => {
  installPipelineTestEnv();
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  resetDigestLlmClientCache();
});

describe("translateOverflowTitles fallback", () => {
  test("primary success does not call fallback", async () => {
    const { requests } = installTranslateFetch((request) => jsonOk(request.paperIds, request.model));
    const result = await translateOverflowTitles({
      papers: [
        overflowPaper("keep"),
        overflowPaper("featured", { featured: true }),
        overflowPaper("skipped", { digestLine: "skip" }),
      ],
      config: digestConfig(),
    });

    assert.deepEqual(requests.map((request) => request.paperIds), [["keep"]]);
    assert.match(requests[0]!.url, /api\.example\.test/);
    assert.equal(requests[0]!.authorization, "Bearer test-digest-key");
    assert.equal(result.titleZhById.get("keep"), "繁中標題 keep");
    assert.equal(result.stats.requested, 1);
    assert.equal(result.stats.llmTranslated, 1);
    assert.equal(result.stats.primarySucceeded, 1);
    assert.equal(result.stats.fallbackSucceeded, 0);
    assert.equal(result.stats.failed, 0);
    assert.equal(result.models.primarySucceeded, 1);
    assert.equal(result.models.fallback?.succeeded, 0);
    assert.equal(result.models.fallback?.requested, "gemini-3.5-flash-lite");
  });

  test("whole-batch primary failure retries the same papers on fallback", async () => {
    const { requests } = installTranslateFetch((request) => {
      if (request.url.includes("api.example.test")) return httpError(500);
      return jsonOk(request.paperIds, request.model);
    });

    const result = await translateOverflowTitles({
      papers: [overflowPaper("a"), overflowPaper("b")],
      config: digestConfig(),
    });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0]!.paperIds, ["a", "b"]);
    assert.deepEqual(requests[1]!.paperIds, ["a", "b"]);
    assert.match(requests[1]!.url, /generativelanguage\.googleapis\.com/);
    assert.equal(requests[1]!.model, "gemini-3.5-flash-lite");
    assert.equal(requests[1]!.authorization, "Bearer test-gemini-key");
    assert.equal(result.titleZhById.get("a"), "繁中標題 a");
    assert.equal(result.titleZhById.get("b"), "繁中標題 b");
    assert.equal(result.stats.primarySucceeded, 0);
    assert.equal(result.stats.fallbackSucceeded, 2);
    assert.equal(result.stats.llmTranslated, 2);
    assert.equal(result.stats.failed, 0);
    assert.equal(result.models.model.requested, "primary-model");
    assert.equal(result.models.fallback?.succeeded, 2);
  });

  test("fallback failure leaves English titles and does not throw", async () => {
    installTranslateFetch(() => httpError(503));

    const result = await translateOverflowTitles({
      papers: [overflowPaper("a"), overflowPaper("b")],
      config: digestConfig(),
    });

    assert.equal(result.titleZhById.size, 0);
    assert.equal(result.stats.requested, 2);
    assert.equal(result.stats.llmTranslated, 0);
    assert.equal(result.stats.primarySucceeded, 0);
    assert.equal(result.stats.fallbackSucceeded, 0);
    assert.equal(result.stats.failed, 2);
    assert.equal(result.models.succeeded, 0);
    assert.equal(result.models.fallback?.succeeded, 0);
  });

  test("partial primary salvage keeps valid rows when fallback is off", async () => {
    const { requests } = installTranslateFetch((request) => {
      const body = JSON.stringify({
        results: [{ id: request.paperIds[0], title_zh: "只留第一篇" }],
      });
      return new Response(JSON.stringify(chatCompletion(body, request.model)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await translateOverflowTitles({
      papers: [overflowPaper("good"), overflowPaper("missing")],
      config: digestConfig({
        fallbackModel: undefined,
        fallbackApiKey: undefined,
        fallbackBaseUrl: undefined,
      }),
    });

    assert.equal(requests.length, 1);
    assert.equal(result.titleZhById.get("good"), "只留第一篇");
    assert.equal(result.titleZhById.has("missing"), false);
    assert.equal(result.stats.primarySucceeded, 1);
    assert.equal(result.stats.fallbackSucceeded, 0);
    assert.equal(result.stats.failed, 1);
    assert.equal(result.models.fallback, undefined);
  });

  test("partial primary salvage retries only the missing ids on fallback", async () => {
    const { requests } = installTranslateFetch((request) => {
      if (request.url.includes("api.example.test")) {
        const body = JSON.stringify({
          results: [{ id: "good", title_zh: "主模型標題" }],
        });
        return new Response(JSON.stringify(chatCompletion(body, request.model)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonOk(request.paperIds, "observed-fallback");
    });

    const result = await translateOverflowTitles({
      papers: [overflowPaper("good"), overflowPaper("missing")],
      config: digestConfig(),
    });

    assert.deepEqual(requests.map((request) => request.paperIds), [["good", "missing"], ["missing"]]);
    assert.equal(result.titleZhById.get("good"), "主模型標題");
    assert.equal(result.titleZhById.get("missing"), "繁中標題 missing");
    assert.equal(result.stats.primarySucceeded, 1);
    assert.equal(result.stats.fallbackSucceeded, 1);
    assert.equal(result.stats.llmTranslated, 2);
    assert.equal(result.stats.failed, 0);
    assert.deepEqual(result.models.fallback?.observed, ["observed-fallback"]);
  });
});
