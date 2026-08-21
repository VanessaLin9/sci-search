import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { classifySpatialWithLlm } from "../../src/digest/classifySpatial.js";
import { SPATIAL_CLASSIFIER_SYSTEM_PROMPT } from "../../src/domain/life-science/prompts/spatial.system.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import type { ClassifiedPaper } from "../../src/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";
import { installLlmRateLimitTestHarness } from "../../src/llm/llmTransportRateLimit.js";

function paper(
  id: string,
  overrides: Partial<ClassifiedPaper> = {},
): ClassifiedPaper {
  return {
    id,
    title: `Long-form research article about molecular pathways ${id}`,
    journal: "Nature Methods",
    publishedDate: "2026-08-19",
    url: `https://example.com/${id}`,
    sourceId: "nature-methods",
    matchedKeywords: overrides.section === "single-cell-spatial" ? ["spatial transcriptomics"] : [],
    section: "biology",
    abstract: "English abstract for eligibility.",
    ...overrides,
  };
}

function chatCompletion(content: string): ChatCompletion {
  return {
    id: "chatcmpl-spatial-test",
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

async function parseSpatialRequestPapers(init?: RequestInit): Promise<Array<{ id: string }>> {
  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body
        ? await new Response(init.body).text()
        : "";
  if (!body) {
    throw new Error("Missing request body");
  }
  const request = JSON.parse(body) as {
    messages?: Array<{ role?: string; content?: string }>;
  };
  const system = request.messages?.find((message) => message.role === "system")?.content ?? "";
  if (!system.includes(SPATIAL_CLASSIFIER_SYSTEM_PROMPT.slice(0, 40))) {
    throw new Error("Not a spatial classify completion request");
  }
  const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
  const payloadStart = user.indexOf("{");
  const payload = JSON.parse(user.slice(payloadStart)) as {
    papers: Array<{ id: string }>;
  };
  return payload.papers;
}

let originalFetch: typeof fetch;

before(() => {
  installPipelineTestEnv();
  installLlmRateLimitTestHarness({ minStartIntervalMs: 0 });
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  resetRoutingLlmClientCache();
});

describe("classifySpatialWithLlm orchestration", { concurrency: 1 }, () => {
  test("failed first batch falls back while later batch still LLM-classifies", async () => {
    // digest maxPapersPerBatch=8 → 9 papers become batch(8) + batch(1).
    const papers = Array.from({ length: 9 }, (_, index) => {
      const id = `p-${index}`;
      return paper(id, {
        section: index < 8 ? "biology" : "single-cell-spatial",
        matchedKeywords: index < 8 ? [] : ["spatial transcriptomics"],
      });
    });

    let callIndex = 0;
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      const requested = await parseSpatialRequestPapers(init);
      callIndex += 1;
      if (callIndex === 1) {
        assert.equal(requested.length, 8);
        throw new Error("Request timed out.");
      }
      assert.equal(requested.length, 1);
      assert.equal(requested[0]?.id, "p-8");
      return new Response(
        JSON.stringify(
          chatCompletion(
            JSON.stringify({
              results: [{ id: "p-8", spatial_confidence: 0.91 }],
            }),
          ),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await classifySpatialWithLlm({ papers });

    assert.equal(callIndex, 2);
    assert.equal(result.llmClassifiedIds.has("p-8"), true);
    assert.equal(result.lineById.get("p-8"), "line-a");
    assert.equal(result.stats.llmTagged, 1);
    assert.equal(result.stats.fallback, 8);
    assert.equal(result.stats.failures, 8);
    for (let index = 0; index < 8; index += 1) {
      assert.equal(result.lineById.get(`p-${index}`), "line-b");
      assert.equal(result.llmClassifiedIds.has(`p-${index}`), false);
    }
  });

  test("partial batch response keyword-falls missing ids and continues", async () => {
    const papers = [
      paper("keep-a", { section: "single-cell-spatial", matchedKeywords: ["spatial transcriptomics"] }),
      paper("missing-kw-a", {
        section: "single-cell-spatial",
        matchedKeywords: ["Visium"],
      }),
      paper("missing-b", { section: "biology", matchedKeywords: [] }),
    ];

    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      const requested = await parseSpatialRequestPapers(init);
      assert.deepEqual(
        requested.map((item) => item.id),
        ["keep-a", "missing-kw-a", "missing-b"],
      );
      return new Response(
        JSON.stringify(
          chatCompletion(
            JSON.stringify({
              results: [{ id: "keep-a", spatial_confidence: 0.8 }],
            }),
          ),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await classifySpatialWithLlm({ papers });

    assert.equal(result.lineById.get("keep-a"), "line-a");
    assert.equal(result.llmClassifiedIds.has("keep-a"), true);
    assert.equal(result.lineById.get("missing-kw-a"), "line-a");
    assert.equal(result.llmClassifiedIds.has("missing-kw-a"), false);
    assert.equal(result.lineById.get("missing-b"), "line-b");
    assert.equal(result.stats.llmTagged, 1);
    assert.equal(result.stats.fallback, 2);
    assert.equal(result.stats.failures, 2);
  });

  test("skips preprint candidates entirely", async () => {
    const papers = [
      paper("journal", { section: "biology" }),
      paper("pre", { sourceId: "biorxiv", section: "single-cell-spatial" }),
    ];

    let calls = 0;
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
      calls += 1;
      const requested = await parseSpatialRequestPapers(init);
      assert.deepEqual(
        requested.map((item) => item.id),
        ["journal"],
      );
      return new Response(
        JSON.stringify(
          chatCompletion(JSON.stringify({ results: [{ id: "journal", spatial_confidence: 0.1 }] })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await classifySpatialWithLlm({ papers });
    assert.equal(calls, 1);
    assert.equal(result.lineById.has("pre"), false);
    assert.equal(result.stats.llmClassified, 1);
    assert.equal(result.lineById.get("journal"), "line-b");
  });
});
