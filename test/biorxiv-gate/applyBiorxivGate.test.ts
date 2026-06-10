import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { applyBiorxivGate } from "../../src/biorxiv-gate/applyBiorxivGate.js";
import { BIORXIV_GATE_SYSTEM_PROMPT } from "../../src/biorxiv-gate/gatePrompt.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import type { Paper } from "../../src/types.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

function paper(id: string): Paper {
  return {
    id,
    title: `Title ${id}`,
    journal: "bioRxiv",
    publishedDate: "2026-06-01",
    url: `https://example.com/${id}`,
    abstract: "single-cell RNA-seq atlas",
    sourceId: "biorxiv",
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

function gateResponse(verdicts: Record<string, "yes" | "no" | "not_sure">): Response {
  const results = Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict }));
  return new Response(JSON.stringify(chatCompletion(JSON.stringify({ results }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let originalFetch: typeof fetch;

before(() => {
  installPipelineTestEnv();
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("applyBiorxivGate", { concurrency: 1 }, () => {
  test("keeps only yes verdict papers", async () => {
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input, init) => {
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
      assert.ok(system.includes(BIORXIV_GATE_SYSTEM_PROMPT.slice(0, 40)));
      return gateResponse({ a: "yes", b: "no", c: "not_sure" });
    }) as typeof fetch;

    const result = await applyBiorxivGate([paper("a"), paper("b"), paper("c")]);

    assert.equal(result.usedFallback, false);
    assert.deepEqual(
      result.papers.map((entry) => entry.id),
      ["a"],
    );
  });

  test("falls back to keyword-only papers when classifier throws", async () => {
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      throw new Error("Request timed out.");
    }) as typeof fetch;

    const papers = [paper("a"), paper("b")];
    const result = await applyBiorxivGate(papers);

    assert.equal(result.usedFallback, true);
    assert.deepEqual(
      result.papers.map((entry) => entry.id),
      ["a", "b"],
    );
  });

  test("falls back when response JSON is invalid", async () => {
    resetRoutingLlmClientCache();
    globalThis.fetch = (async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/chat/completions")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return new Response(JSON.stringify(chatCompletion("not json")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const papers = [paper("a")];
    const result = await applyBiorxivGate(papers);

    assert.equal(result.usedFallback, true);
    assert.equal(result.papers.length, 1);
  });
});
