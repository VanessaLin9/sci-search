import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { callBiorxivGateCompletion } from "../../src/biorxiv-gate/callGateCompletion.js";
import { callDigestTaggingCompletion } from "../../src/digest/callDigestCompletion.js";
import type { DigestLlmConfig } from "../../src/digest/config.js";
import { resetDigestLlmClientCache } from "../../src/digest/digestLlmClient.js";
import { callRoutingCompletion } from "../../src/routing/callRoutingCompletion.js";
import type { RoutingLlmConfig } from "../../src/routing/config.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

type CapturedBody = {
  response_format?: { type?: string };
};

function chatCompletion(content: string): ChatCompletion {
  return {
    id: "chatcmpl-wrapper-fallback",
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
    usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
  };
}

function routingConfig(): RoutingLlmConfig {
  return {
    apiKey: "test-routing-key",
    // Non-NVIDIA base URL so preferJsonResponseFormat can be true in real configs.
    baseUrl: "https://api.example.test/v1",
    model: "test-model",
    maxPapersPerBatch: 40,
    maxInputTokens: 28000,
    timeoutMs: 5_000,
    maxTokens: 1024,
    // Avoid SDK HTTP retries masking the wrapper's response_format fallback.
    maxRetries: 0,
    preferJsonResponseFormat: true,
    disableThinking: false,
  };
}

function digestConfig(): DigestLlmConfig {
  return {
    apiKey: "test-digest-key",
    baseUrl: "https://api.example.test/v1",
    model: "test-model",
    maxFeatured: 12,
    overflowShowTitleZh: true,
    maxPapersPerBatch: 20,
    maxInputTokens: 28000,
    timeoutMs: 5_000,
    maxTokens: 1024,
    maxRetries: 0,
    summarizeTimeoutMs: 5_000,
    summarizeMaxRetries: 0,
    summarizeConcurrency: 1,
    preferJsonResponseFormat: true,
    disableThinking: false,
  };
}

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
  resetRoutingLlmClientCache();
  resetDigestLlmClientCache();
});

function installJsonModeThenPlainSuccessFetch(): {
  bodies: CapturedBody[];
  logs: string[];
} {
  const bodies: CapturedBody[] = [];
  const logs: string[] = [];

  resetRoutingLlmClientCache();
  resetDigestLlmClientCache();

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  globalThis.fetch = (async (_input, init) => {
    const raw =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? await new Response(init.body).text()
          : "";
    const body = JSON.parse(raw) as CapturedBody;
    bodies.push(body);

    if (bodies.length === 1) {
      assert.deepEqual(body.response_format, { type: "json_object" });
      throw new Error("json_object unsupported");
    }

    assert.equal(
      body.response_format,
      undefined,
      "fallback request must omit response_format",
    );
    return new Response(JSON.stringify(chatCompletion('{"results":[]}')), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { bodies, logs };
}

describe("wrapper JSON response_format fallback characterization", { concurrency: 1 }, () => {
  test("callRoutingCompletion omits response_format on fallback success", async () => {
    const { bodies, logs } = installJsonModeThenPlainSuccessFetch();

    const result = await callRoutingCompletion(
      [{ id: "p1", title: "Title", journal: "Science", source_id: "science" }],
      routingConfig(),
      { label: "batch-1" },
    );

    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
    assert.equal(bodies[1]?.response_format, undefined);
    assert.equal(result.usedJsonResponseFormat, false);
    assert.ok(result.completion);
    assert.ok(result.elapsedMs >= 0);
    assert.ok(
      logs.some((line) =>
        line.includes("batch-1: json_object mode failed, retrying without response_format…"),
      ),
    );
    assert.ok(logs.some((line) => line.includes("batch-1: HTTP ok in")));
  });

  test("callBiorxivGateCompletion omits response_format on fallback success", async () => {
    const { bodies, logs } = installJsonModeThenPlainSuccessFetch();

    const result = await callBiorxivGateCompletion(
      [
        {
          id: "p1",
          title: "Title",
          abstract: "Abstract with single-cell transcriptomics.",
        },
      ],
      routingConfig(),
      { label: "batch-1" },
    );

    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
    assert.equal(bodies[1]?.response_format, undefined);
    assert.equal(result.usedJsonResponseFormat, false);
    assert.ok(result.completion);
    assert.ok(result.elapsedMs >= 0);
    assert.ok(
      logs.some((line) =>
        line.includes("batch-1: json_object mode failed, retrying without response_format…"),
      ),
    );
    assert.ok(logs.some((line) => line.includes("batch-1: HTTP ok in")));
  });

  test("callDigestTaggingCompletion omits response_format on fallback success", async () => {
    const { bodies, logs } = installJsonModeThenPlainSuccessFetch();

    const completion = await callDigestTaggingCompletion(
      [
        {
          id: "p1",
          title: "Title",
          journal: "Science",
          source_id: "science",
          scope: "broad-science",
        },
      ],
      digestConfig(),
      { label: "digest-tag" },
    );

    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
    assert.equal(bodies[1]?.response_format, undefined);
    assert.ok(completion);
    assert.equal(completion.id, "chatcmpl-wrapper-fallback");
    assert.ok(
      logs.some((line) =>
        line.includes("digest-tag: json_object failed, retrying without response_format…"),
      ),
    );
    assert.ok(
      !logs.some((line) => line.includes("json_object mode failed")),
      "digest must keep wording without 'mode'",
    );
    assert.ok(logs.some((line) => line.includes("digest-tag: HTTP ok in")));
  });
});
