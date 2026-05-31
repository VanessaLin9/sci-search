import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKeywords, loadSources } from "../../src/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { buildSourceScopeById } from "../../src/routing/sourceScope.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

const REPORT_DATE = "2026-05-28";
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/biorxiv");

let originalFetch: typeof fetch;

function createBiorxivOnlyFetch(): typeof fetch {
  const samplePage = JSON.parse(readFileSync(join(FIXTURE_DIR, "sample-page.json"), "utf8"));

  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("api.biorxiv.org/details/biorxiv")) {
      return new Response(JSON.stringify(samplePage), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch in bioRxiv pipeline test: ${url}`);
  };
}

describe("bioRxiv pipeline integration", () => {
  before(() => {
    installPipelineTestEnv();
    process.env.ENABLE_LLM_DIGEST = "0";
    originalFetch = globalThis.fetch;
    globalThis.fetch = createBiorxivOnlyFetch() as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("ingests bioRxiv records and assigns preprint digest line via keyword fallback", async () => {
    const sources = await loadSources();
    const keywords = await loadKeywords();
    const scopeBySourceId = buildSourceScopeById(sources);

    const result = await runPipeline({
      sources,
      keywords,
      reportDate: REPORT_DATE,
      scopeBySourceId,
      rssSourceIds: [],
      biorxivSourceIds: ["biorxiv"],
    });

    const biorxivStats = result.sourceResults.find((entry) => entry.stats.sourceId === "biorxiv");
    assert.ok(biorxivStats);
    assert.equal(biorxivStats.stats.onReportDateCount, 1);

    const biorxivPaper = result.papers.find((paper) => paper.sourceId === "biorxiv");
    assert.ok(biorxivPaper);
    assert.equal(biorxivPaper.digestLine, "preprint");
    assert.equal(result.digest.selection.preprint, 1);
    assert.ok(result.routing.included.some((paper) => paper.sourceId === "biorxiv"));
  });
});
