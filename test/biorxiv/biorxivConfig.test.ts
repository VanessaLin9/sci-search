import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBiorxivFileConfig } from "../../src/config.js";

test("biorxiv.json lists configured ingest categories", () => {
  const config = loadBiorxivFileConfig();

  assert.deepEqual(config.categories, [
    "cell_biology",
    "genomics",
    "bioinformatics",
    "systems_biology",
    "cancer_biology",
    "developmental_biology",
  ]);
});
