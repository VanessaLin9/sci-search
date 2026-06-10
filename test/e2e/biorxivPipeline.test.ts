import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKeywords, loadSources } from "../../src/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { resetRoutingLlmClientCache } from "../../src/routing/routingLlmClient.js";
import { buildSourceScopeById } from "../../src/routing/sourceScope.js";
import { createBiorxivPipelineFetch } from "../helpers/biorxivPipelineFetch.js";
import { installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";

const REPORT_DATE = "2026-05-28";
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/biorxiv");
const SAMPLE_PAGE = JSON.parse(readFileSync(join(FIXTURE_DIR, "sample-page.json"), "utf8"));
const SAMPLE_DOI = "10.1101/2026.05.28.123456";

let originalFetch: typeof fetch;

function installBiorxivFetch(
  gate: Parameters<typeof createBiorxivPipelineFetch>[0]["gate"],
): void {
  resetRoutingLlmClientCache();
  globalThis.fetch = createBiorxivPipelineFetch({
    biorxivSamplePage: SAMPLE_PAGE,
    gate,
  }) as typeof fetch;
}

describe("bioRxiv pipeline integration", () => {
  before(() => {
    installPipelineTestEnv();
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("ingests bioRxiv records when LLM gate returns yes", async () => {
    installBiorxivFetch({ kind: "verdict", verdict: "yes" });

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

  it("drops keyword-matched bioRxiv papers when gate returns no", async () => {
    installBiorxivFetch({
      kind: "verdictById",
      verdictById: { [SAMPLE_DOI]: "no" },
    });

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
    assert.equal(biorxivStats.stats.onReportDateCount, 0);
    assert.equal(result.papers.some((paper) => paper.sourceId === "biorxiv"), false);
  });

  it("drops keyword-matched bioRxiv papers when gate returns not_sure", async () => {
    installBiorxivFetch({
      kind: "verdictById",
      verdictById: { [SAMPLE_DOI]: "not_sure" },
    });

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
    assert.equal(biorxivStats.stats.onReportDateCount, 0);
    assert.equal(result.papers.some((paper) => paper.sourceId === "biorxiv"), false);
  });

  it("falls back to keyword matches when bioRxiv gate fails", async () => {
    installBiorxivFetch({
      kind: "throw",
      error: new Error("Request timed out."),
    });

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
    assert.ok(result.papers.some((paper) => paper.id === SAMPLE_DOI));
  });
});
