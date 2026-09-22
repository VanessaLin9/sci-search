import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  displayLlmModel,
  llmModelUsage,
  observedLlmModel,
  sanitizeDigestLlmModelsSnapshot,
  sanitizePersistedLlmModelUsage,
  uniqueModels,
} from "../../src/llm/llmModelUsage.js";

describe("llmModelUsage", () => {
  test("observedLlmModel trims and drops empty ids", () => {
    assert.equal(observedLlmModel({ model: "  muse  " }), "muse");
    assert.equal(observedLlmModel({ model: "" }), undefined);
    assert.equal(observedLlmModel({ model: null }), undefined);
    assert.equal(observedLlmModel({}), undefined);
  });

  test("displayLlmModel prefers a single observed id over requested", () => {
    assert.equal(displayLlmModel({ requested: "env-id", observed: ["api-id"] }), "api-id");
    assert.equal(displayLlmModel({ requested: "env-id" }), "env-id");
    assert.equal(
      displayLlmModel({ requested: "env-id", observed: ["a", "b"] }),
      "a · b",
    );
  });

  test("llmModelUsage omits observed when none were recorded", () => {
    assert.deepEqual(llmModelUsage("env-id", ["", undefined, "  "]), { requested: "env-id" });
    assert.deepEqual(llmModelUsage("env-id", ["x", "x", " y "]), {
      requested: "env-id",
      observed: ["x", "y"],
    });
  });

  test("uniqueModels keeps first-seen order", () => {
    assert.deepEqual(uniqueModels(["b", "a", "b", "a"]), ["b", "a"]);
  });

  test("sanitizePersistedLlmModelUsage drops empty requested and blank observed", () => {
    assert.equal(sanitizePersistedLlmModelUsage({ requested: "" }), undefined);
    assert.equal(sanitizePersistedLlmModelUsage({ requested: "  " }), undefined);
    assert.equal(sanitizePersistedLlmModelUsage("nope"), undefined);
    assert.deepEqual(sanitizePersistedLlmModelUsage({ requested: "env", observed: ["", " api "] }), {
      requested: "env",
      observed: ["api"],
    });
  });

  test("sanitizeDigestLlmModelsSnapshot drops summarize when primary is missing", () => {
    const snapshot = sanitizeDigestLlmModelsSnapshot({
      spatial: { requested: "routing" },
      summarize: { requested: 10, failed: 0 },
    });
    assert.deepEqual(snapshot, { spatial: { requested: "routing" } });
  });
});
