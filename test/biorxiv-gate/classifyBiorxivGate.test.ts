import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { classifyBiorxivGatePapers } from "../../src/biorxiv-gate/classifyBiorxivGate.js";
import { BIORXIV_GATE_SYSTEM_PROMPT } from "../../src/biorxiv-gate/gatePrompt.js";
import type { BiorxivGateInput } from "../../src/biorxiv-gate/types.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

type GateMockPlan = {
  omitIds?: string[];
  verdict?: "yes" | "no" | "not_sure";
};

function gateInput(id: string): BiorxivGateInput {
  return {
    id,
    title: `Title ${id}`,
    abstract: `Abstract for ${id} with single-cell transcriptomics.`,
  };
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

function gateResponse(
  papers: Array<{ id: string }>,
  plan: GateMockPlan = {},
): Response {
  const omit = new Set(plan.omitIds ?? []);
  const verdict = plan.verdict ?? "yes";
  const results = papers
    .filter((item) => !omit.has(item.id))
    .map((item) => ({ id: item.id, verdict }));
  return new Response(JSON.stringify(chatCompletion(JSON.stringify({ results }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createGateMockFetch(plans: GateMockPlan[]): typeof fetch {
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
    if (!system.includes(BIORXIV_GATE_SYSTEM_PROMPT.slice(0, 40))) {
      throw new Error("Not a bioRxiv gate completion request");
    }

    const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
    const payloadStart = user.indexOf("{");
    const payload = JSON.parse(user.slice(payloadStart)) as {
      papers: Array<{ id: string }>;
    };
    const plan = plans[callIndex] ?? plans[plans.length - 1] ?? {};
    callIndex += 1;
    return gateResponse(payload.papers, plan);
  };
}

let originalFetch: typeof fetch;
let gateCallCount = 0;

function installGateFetch(plans: GateMockPlan[]): void {
  gateCallCount = 0;
  resetRoutingLlmClientCache();
  const baseFetch = createGateMockFetch(plans);
  globalThis.fetch = (async (...args) => {
    gateCallCount += 1;
    return baseFetch(...args);
  }) as typeof fetch;
}

before(() => {
  installPipelineTestEnv();
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("classifyBiorxivGatePapers", { concurrency: 1 }, () => {
  test("parses yes, no, and not_sure verdicts", async () => {
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
      const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
      const payloadStart = user.indexOf("{");
      const payload = JSON.parse(user.slice(payloadStart)) as {
        papers: Array<{ id: string }>;
      };
      const verdictById: Record<string, "yes" | "no" | "not_sure"> = {
        a: "yes",
        b: "no",
        c: "not_sure",
      };
      const results = payload.papers.map((item) => ({
        id: item.id,
        verdict: verdictById[item.id] ?? "no",
      }));
      return new Response(JSON.stringify(chatCompletion(JSON.stringify({ results }))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const items = [gateInput("a"), gateInput("b"), gateInput("c")];
    const verdictById = await classifyBiorxivGatePapers(items);

    assert.equal(verdictById.get("a"), "yes");
    assert.equal(verdictById.get("b"), "no");
    assert.equal(verdictById.get("c"), "not_sure");
  });

  test("retries missing verdict batch once then succeeds", async () => {
    const items = [gateInput("a"), gateInput("b"), gateInput("c"), gateInput("d")];
    installGateFetch([{ omitIds: ["c"] }, {}]);

    const verdictById = await classifyBiorxivGatePapers(items);

    assert.equal(gateCallCount, 2);
    assert.equal(verdictById.get("c"), "yes");
  });

  test("throws when retry still misses verdicts", async () => {
    const missingId = "missing-id";
    const items = [gateInput("a"), gateInput(missingId)];
    installGateFetch([{ omitIds: [missingId] }, { omitIds: [missingId] }]);

    await assert.rejects(
      () => classifyBiorxivGatePapers(items),
      /incomplete bioRxiv gate verdicts/,
    );
    assert.equal(gateCallCount, 2);
  });

  test("throws when response content has no JSON object", async () => {
    resetRoutingLlmClientCache();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify(
          chatCompletion("not json", 8),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    await assert.rejects(
      () => classifyBiorxivGatePapers([gateInput("a")]),
      /no JSON object/,
    );
  });

  test("throws when JSON does not match gate response schema", async () => {
    resetRoutingLlmClientCache();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify(chatCompletion(JSON.stringify({ results: "bad" }), 8)),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    await assert.rejects(
      () => classifyBiorxivGatePapers([gateInput("a")]),
      /invalid JSON/,
    );
  });
});
