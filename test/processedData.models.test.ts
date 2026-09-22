import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateProcessedPapersFile } from "../src/processedData.js";

describe("processed papers.json model fields", () => {
  test("legacy files without model snapshots still parse", () => {
    const parsed = validateProcessedPapersFile({
      reportDate: "2026-09-21",
      papers: [],
      routing: {
        enabled: true,
        stats: {
          total: 0,
          passedByScope: 0,
          llmClassified: 0,
          llmYes: 0,
          llmNotSure: 0,
          llmNo: 0,
          included: 0,
          excluded: 0,
        },
      },
      digest: {
        enabled: true,
        llmTagging: true,
        tagging: {
          llmClassified: 0,
          llmTagged: 0,
          fallback: 0,
        },
        selection: {
          total: 0,
          candidates: 0,
          featured: 0,
          overflow: 0,
          lineA: 0,
          lineB: 0,
          preprint: 0,
          skip: 0,
        },
      },
    });

    assert.equal(parsed.routing?.model, undefined);
    assert.equal(parsed.digest?.models, undefined);
  });

  test("persists requested and observed model ids", () => {
    const parsed = validateProcessedPapersFile({
      reportDate: "2026-09-23",
      papers: [],
      routing: {
        enabled: true,
        stats: {
          total: 1,
          passedByScope: 0,
          llmClassified: 1,
          llmYes: 1,
          llmNotSure: 0,
          llmNo: 0,
          included: 1,
          excluded: 0,
        },
        model: { requested: "env-routing", observed: ["api-routing"] },
      },
      digest: {
        enabled: true,
        llmTagging: true,
        tagging: {
          llmClassified: 1,
          llmTagged: 1,
          fallback: 0,
        },
        selection: {
          total: 1,
          candidates: 1,
          featured: 1,
          overflow: 0,
          lineA: 0,
          lineB: 1,
          preprint: 0,
          skip: 0,
        },
        models: {
          spatial: { requested: "env-routing", observed: ["api-routing"], llmTagged: 1 },
          summarize: {
            requested: 1,
            failed: 0,
            primary: { requested: "env-primary", observed: ["api-primary"], succeeded: 1 },
          },
        },
      },
    });

    assert.equal(parsed.routing?.model?.requested, "env-routing");
    assert.deepEqual(parsed.digest?.models?.summarize?.primary.observed, ["api-primary"]);
  });

  test("malformed optional model metadata is dropped instead of failing parse", () => {
    const parsed = validateProcessedPapersFile({
      reportDate: "2026-09-23",
      papers: [],
      routing: {
        enabled: true,
        stats: {
          total: 0,
          passedByScope: 0,
          llmClassified: 0,
          llmYes: 0,
          llmNotSure: 0,
          llmNo: 0,
          included: 0,
          excluded: 0,
        },
        model: { requested: "" },
      },
      digest: {
        enabled: true,
        llmTagging: true,
        tagging: {
          llmClassified: 0,
          llmTagged: 0,
          fallback: 0,
        },
        selection: {
          total: 0,
          candidates: 0,
          featured: 0,
          overflow: 0,
          lineA: 0,
          lineB: 0,
          preprint: 0,
          skip: 0,
        },
        models: {
          spatial: { requested: " ", observed: [""] },
          summarize: { requested: 10, failed: 3 },
          translate: { requested: 1, succeeded: 1, failed: 0, model: { requested: "ok" } },
        },
      },
    });

    assert.equal(parsed.routing?.enabled, true);
    assert.equal(parsed.routing?.model, undefined);
    assert.equal(parsed.digest?.models?.spatial, undefined);
    assert.equal(parsed.digest?.models?.summarize, undefined);
    assert.equal(parsed.digest?.models?.translate?.model.requested, "ok");
  });
});
