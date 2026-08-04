import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { DigestLlmConfig } from "../../src/digest/config.js";
import { resetDigestLlmClientCache } from "../../src/digest/digestLlmClient.js";
import { summarizeFeaturedPapers } from "../../src/digest/summarizePapers.js";
import type { ClassifiedPaper, SourceScope } from "../../src/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";
import { createFakeClock } from "../routing/helpers/fakeClock.js";

type RequestRecord = {
  model: string;
  paperId: string;
};

function featuredPaper(id: string): ClassifiedPaper {
  return {
    id,
    title: `Title ${id}`,
    journal: "Test Journal",
    publishedDate: "2026-08-01",
    url: `https://example.test/${id}`,
    doi: `10.test/${id}`,
    abstract: "A short abstract suitable for summarize fixtures.",
    sourceId: "science",
    matchedKeywords: [],
    section: "other",
    digestLine: "line-b",
    featured: true,
  };
}

function digestConfig(overrides: Partial<DigestLlmConfig> = {}): DigestLlmConfig {
  return {
    apiKey: "test-digest-key",
    baseUrl: "https://api.example.test/v1",
    model: "primary-model",
    fallbackModel: "fallback-model",
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
    id: "chatcmpl-summarize-test",
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

function successBody(paperId: string): string {
  return JSON.stringify({
    id: paperId,
    title_zh: `繁中標題 ${paperId}`,
    summary_zh: `繁中摘要 ${paperId}`,
    topic_tags: ["tag-a", "tag-b"],
  });
}

function parseRequest(init?: RequestInit): { model: string; paperId: string } {
  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body
        ? undefined
        : undefined;
  if (!body || typeof body !== "string") {
    throw new Error("missing chat completion body");
  }
  const request = JSON.parse(body) as {
    model?: string;
    messages?: Array<{ role?: string; content?: string }>;
  };
  const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
  const payloadStart = user.indexOf("{");
  const payload = JSON.parse(user.slice(payloadStart)) as { paper: { id: string } };
  return { model: request.model ?? "", paperId: payload.paper.id };
}

type MockHandler = (request: RequestRecord, callIndex: number) => Response;

function installSummarizeFetch(handler: MockHandler): {
  requests: RequestRecord[];
} {
  const requests: RequestRecord[] = [];
  resetDigestLlmClientCache();
  let callIndex = 0;

  globalThis.fetch = (async (_input, init) => {
    const request = parseRequest(init);
    requests.push(request);
    const index = callIndex;
    callIndex += 1;
    return handler(request, index);
  }) as typeof fetch;

  return { requests };
}

function jsonOk(paperId: string, model: string): Response {
  return new Response(JSON.stringify(chatCompletion(successBody(paperId), model)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function httpError(status: number, message: string, headers?: Record<string, string>): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain", ...headers },
  });
}

const scopeBySourceId = new Map<string, SourceScope>([["science", "broad-science"]]);

let originalFetch: typeof fetch;
let originalConsoleLog: typeof console.log;

before(() => {
  installPipelineTestEnv();
  originalFetch = globalThis.fetch;
  originalConsoleLog = console.log;
});

after(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  resetDigestLlmClientCache();
});

describe("summarizeFeaturedPapers dual-model fallback", () => {
  test("primary success keeps fields and does not call fallback", async () => {
    const paper = featuredPaper("p1");
    const { requests } = installSummarizeFetch((request) => jsonOk(request.paperId, request.model));

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock: createFakeClock(),
      jitterMs: () => 0,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, "primary-model");
    assert.equal(fieldsById.get("p1")?.titleZh, "繁中標題 p1");
    assert.deepEqual(stats, {
      requested: 1,
      llmSummarized: 1,
      primarySucceeded: 1,
      fallbackSucceeded: 0,
      failed: 0,
    });
  });

  test("primary 529 goes to fallback without same-model retry", async () => {
    const paper = featuredPaper("p2");
    const { requests } = installSummarizeFetch((request) => {
      if (request.model === "primary-model") {
        return httpError(529, "529 status code (no body)");
      }
      return jsonOk(request.paperId, request.model);
    });

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock: createFakeClock(),
      jitterMs: () => 0,
    });

    assert.deepEqual(
      requests.map((item) => item.model),
      ["primary-model", "fallback-model"],
    );
    assert.equal(fieldsById.get("p2")?.summaryZh, "繁中摘要 p2");
    assert.deepEqual(stats, {
      requested: 1,
      llmSummarized: 1,
      primarySucceeded: 0,
      fallbackSucceeded: 1,
      failed: 0,
    });
  });

  test("both models fail keeps English card stats", async () => {
    const paper = featuredPaper("p3");
    installSummarizeFetch((request) => httpError(503, `${request.model} unavailable`));

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock: createFakeClock(),
      jitterMs: () => 0,
    });

    assert.equal(fieldsById.size, 0);
    assert.deepEqual(stats, {
      requested: 1,
      llmSummarized: 0,
      primarySucceeded: 0,
      fallbackSucceeded: 0,
      failed: 1,
    });
  });

  test("429 waits once then retries primary before fallback", async () => {
    const paper = featuredPaper("p4");
    const clock = createFakeClock();
    let primaryCalls = 0;
    const { requests } = installSummarizeFetch((request) => {
      if (request.model === "primary-model") {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          return httpError(429, "rate limited", { "retry-after": "1" });
        }
        return httpError(529, "still overloaded");
      }
      return jsonOk(request.paperId, request.model);
    });

    const { stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock,
      jitterMs: () => 0,
    });

    assert.deepEqual(
      requests.map((item) => item.model),
      ["primary-model", "primary-model", "fallback-model"],
    );
    assert.deepEqual(clock.sleeps, [1_000]);
    assert.deepEqual(stats, {
      requested: 1,
      llmSummarized: 1,
      primarySucceeded: 0,
      fallbackSucceeded: 1,
      failed: 0,
    });
  });

  test("429 with successful primary retry never calls fallback", async () => {
    const paper = featuredPaper("p5");
    const clock = createFakeClock();
    let primaryCalls = 0;
    const { requests } = installSummarizeFetch((request) => {
      if (request.model === "primary-model") {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          return httpError(429, "rate limited", { "retry-after": "2" });
        }
        return jsonOk(request.paperId, request.model);
      }
      throw new Error("fallback should not run");
    });

    const { stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock,
      jitterMs: () => 0,
    });

    assert.deepEqual(
      requests.map((item) => item.model),
      ["primary-model", "primary-model"],
    );
    assert.deepEqual(clock.sleeps, [2_000]);
    assert.equal(stats.primarySucceeded, 1);
    assert.equal(stats.fallbackSucceeded, 0);
  });

  test("budget exhaustion skips fallback and counts as failed", async () => {
    const paper = featuredPaper("p6");
    const clock = createFakeClock();
    const { requests } = installSummarizeFetch((request) => {
      if (request.model === "primary-model") {
        // Advance wall budget past stage limit before fallback can start.
        clock.advance(900_000);
        return httpError(529, "529 status code (no body)");
      }
      throw new Error("fallback should be budget-skipped");
    });

    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig({ summarizeStageBudgetMs: 900_000 }),
      clock,
      jitterMs: () => 0,
    });

    assert.deepEqual(
      requests.map((item) => item.model),
      ["primary-model"],
    );
    assert.equal(fieldsById.size, 0);
    assert.equal(stats.failed, 1);
    assert.match(logs.join("\n"), /role=fallback reason=budget_exhausted/);
  });

  test("partial success: one primary ok, one fallback ok, one failed", async () => {
    const papers = [featuredPaper("ok"), featuredPaper("fb"), featuredPaper("bad")];
    const { requests } = installSummarizeFetch((request) => {
      if (request.paperId === "ok") {
        return jsonOk(request.paperId, request.model);
      }
      if (request.paperId === "fb") {
        if (request.model === "primary-model") {
          return httpError(500, "primary boom");
        }
        return jsonOk(request.paperId, request.model);
      }
      return httpError(500, "always fail");
    });

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers,
      scopeBySourceId,
      config: digestConfig({ summarizeConcurrency: 1, summarizeFallbackConcurrency: 1 }),
      clock: createFakeClock(),
      jitterMs: () => 0,
    });

    assert.equal(fieldsById.has("ok"), true);
    assert.equal(fieldsById.has("fb"), true);
    assert.equal(fieldsById.has("bad"), false);
    assert.ok(requests.some((item) => item.paperId === "ok" && item.model === "primary-model"));
    assert.ok(requests.some((item) => item.paperId === "fb" && item.model === "fallback-model"));
    assert.ok(!requests.some((item) => item.paperId === "ok" && item.model === "fallback-model"));
    assert.deepEqual(stats, {
      requested: 3,
      llmSummarized: 2,
      primarySucceeded: 1,
      fallbackSucceeded: 1,
      failed: 1,
    });
  });

  test("malformed primary JSON can be recovered by fallback", async () => {
    const paper = featuredPaper("p7");
    const { requests } = installSummarizeFetch((request) => {
      if (request.model === "primary-model") {
        return new Response(
          JSON.stringify(chatCompletion("this is not json", request.model)),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return jsonOk(request.paperId, request.model);
    });

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock: createFakeClock(),
      jitterMs: () => 0,
    });

    assert.deepEqual(
      requests.map((item) => item.model),
      ["primary-model", "fallback-model"],
    );
    assert.equal(fieldsById.get("p7")?.titleZh, "繁中標題 p7");
    assert.equal(stats.fallbackSucceeded, 1);
  });

  test("id mismatch on primary goes to fallback", async () => {
    const paper = featuredPaper("p8");
    installSummarizeFetch((request) => {
      if (request.model === "primary-model") {
        return new Response(
          JSON.stringify(
            chatCompletion(
              JSON.stringify({
                id: "wrong-id",
                title_zh: "錯",
                summary_zh: "錯",
                topic_tags: ["x"],
              }),
              request.model,
            ),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return jsonOk(request.paperId, request.model);
    });

    const { fieldsById, stats } = await summarizeFeaturedPapers({
      papers: [paper],
      scopeBySourceId,
      config: digestConfig(),
      clock: createFakeClock(),
      jitterMs: () => 0,
    });

    assert.equal(fieldsById.get("p8")?.titleZh, "繁中標題 p8");
    assert.equal(stats.primarySucceeded, 0);
    assert.equal(stats.fallbackSucceeded, 1);
  });
});
