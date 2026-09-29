import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toDigestModelFooterLines } from "../../src/email/digestModelFooter.js";
import { renderDigestHtml } from "../../src/email/renderDigestHtml.js";

describe("toDigestModelFooterLines", () => {
  test("formats summarize primary/fallback counts and failed only when > 0", () => {
    const lines = toDigestModelFooterLines({
      routing: {
        enabled: true,
        stats: { llmClassified: 9 },
        model: { requested: "env-routing", observed: ["api-routing"] },
      },
      digest: {
        tagging: { llmTagged: 13 },
        models: {
          spatial: { requested: "env-routing", observed: ["api-routing"], llmTagged: 13 },
          summarize: {
            requested: 10,
            failed: 0,
            primary: { requested: "env-primary", observed: ["api-primary"], succeeded: 7 },
            fallback: { requested: "env-fallback", observed: ["api-fallback"], succeeded: 3 },
          },
          translate: {
            requested: 3,
            succeeded: 3,
            failed: 0,
            model: { requested: "env-primary", observed: ["api-primary"] },
          },
        },
      },
    });

    assert.deepEqual(lines, [
      "routing: api-routing · llm 9",
      "spatial: api-routing · llm 13",
      "summarize: api-primary 7/10，fallback: api-fallback 3/10",
      "translate: api-primary 3/3",
    ]);
  });

  test("formats translate primary/fallback counts when fallback is recorded", () => {
    const lines = toDigestModelFooterLines({
      digest: {
        models: {
          translate: {
            requested: 8,
            succeeded: 6,
            failed: 2,
            model: { requested: "env-primary", observed: ["api-primary"] },
            primarySucceeded: 4,
            fallback: { requested: "env-fallback", observed: ["api-fallback"], succeeded: 2 },
          },
        },
      },
    });

    assert.deepEqual(lines, [
      "translate: api-primary 4/8，fallback: api-fallback 2/8，failed 2",
    ]);
  });

  test("appends failed N and omits fallback clause when unset", () => {
    const lines = toDigestModelFooterLines({
      digest: {
        models: {
          summarize: {
            requested: 10,
            failed: 3,
            primary: { requested: "env-primary", succeeded: 7 },
          },
        },
      },
    });

    assert.deepEqual(lines, ["summarize: env-primary 7/10，failed 3"]);
  });

  test("routing off does not invent a model name", () => {
    assert.deepEqual(toDigestModelFooterLines({ routing: { enabled: false } }), ["routing: off"]);
  });

  test("missing models is fail-open", () => {
    assert.deepEqual(toDigestModelFooterLines(undefined), []);
    assert.deepEqual(toDigestModelFooterLines({ routing: { enabled: true } }), []);
    assert.deepEqual(toDigestModelFooterLines({ digest: {} }), []);
  });
});

describe("renderDigestHtml model footer", () => {
  test("omits model lines for legacy input and still ends with Sent by", () => {
    const html = renderDigestHtml({
      reportDate: "2026-09-23",
      papers: [],
    });
    assert.match(html, /Sent by paper-digest \(Resend\)/);
    assert.doesNotMatch(html, /summarize:/);
    assert.doesNotMatch(html, /routing:/);
  });

  test("escapes model ids in footer", () => {
    const html = renderDigestHtml({
      reportDate: "2026-09-23",
      papers: [],
      modelFooter: {
        routing: {
          enabled: true,
          model: { requested: "a<b>" },
        },
      },
    });
    assert.match(html, /routing: a&lt;b&gt;/);
    assert.doesNotMatch(html, /a<b>/);
  });
});
