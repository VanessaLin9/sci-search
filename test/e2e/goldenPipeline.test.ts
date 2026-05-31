import { after, before, describe, it } from "node:test";
import { buildSourcePriorityById } from "../../src/digest/selectFeatured.js";
import { renderDigestHtml } from "../../src/email/renderDigestHtml.js";
import { loadKeywords, loadSources } from "../../src/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { buildSourceScopeById } from "../../src/routing/sourceScope.js";
import { assertSyntheticDigestHtml, assertSyntheticGoldenOutput } from "../helpers/assertAcceptance.js";
import { buildProcessedFile, installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";
import { createMockFetch } from "../helpers/mockFetch.js";

const REPORT_DATE = "2026-05-25";
let originalFetch: typeof fetch;

before(() => {
  installPipelineTestEnv();
  originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({}) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("golden pipeline e2e", () => {
  it("builds valid papers.json and digest HTML from fixture RSS and mock LLM", async () => {
    const sources = await loadSources();
    const keywords = await loadKeywords();
    const scopeBySourceId = buildSourceScopeById(sources);

    const result = await runPipeline({
      sources,
      keywords,
      reportDate: REPORT_DATE,
      scopeBySourceId,
      rssSourceIds: ["nature-methods"],
      biorxivSourceIds: [],
    });

    const processed = buildProcessedFile(REPORT_DATE, result);
    assertSyntheticGoldenOutput(processed, REPORT_DATE);

    const html = renderDigestHtml({
      reportDate: REPORT_DATE,
      papers: processed.papers,
      generatedAt: processed.generatedAt,
      priorityBySourceId: buildSourcePriorityById(sources),
    });

    assertSyntheticDigestHtml(html, processed);
  });
});
