import { after, before, describe, it } from "node:test";
import { buildSourcePriorityById } from "../../src/digest/selectFeatured.js";
import { renderDigestHtml } from "../../src/email/renderDigestHtml.js";
import { loadKeywords, loadSources } from "../../src/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { buildSourceScopeById } from "../../src/routing/sourceScope.js";
import type { ProcessedPapersFile } from "../../src/processedData.js";
import { assertDigestHtml, assertGoldenPipelineOutput } from "../helpers/assertAcceptance.js";
import { createMockFetch } from "../helpers/mockFetch.js";

const REPORT_DATE = "2026-05-25";
let originalFetch: typeof fetch;

before(() => {
  process.env.ROUTE_LIFE_SCIENCE = "1";
  process.env.ENABLE_LLM_DIGEST = "1";
  process.env.ROUTING_LLM_API_KEY = "test-routing-key";
  process.env.DIGEST_LLM_API_KEY = "test-digest-key";
  process.env.ROUTING_LLM_MODEL = "test-model";
  process.env.DIGEST_LLM_MODEL = "test-model";
  process.env.DEBUG_NORMALIZED = "0";

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
    });

    const processed: ProcessedPapersFile = {
      reportDate: REPORT_DATE,
      generatedAt: new Date().toISOString(),
      papers: result.papers,
      routing: {
        enabled: result.routing.enabled,
        stats: result.routing.stats,
      },
      digest: {
        enabled: result.digest.enabled,
        llmTagging: result.digest.llmTagging,
        tagging: result.digest.tagging,
        selection: result.digest.selection,
        summarize: result.digest.summarize,
        translate: result.digest.translate,
      },
    };

    assertGoldenPipelineOutput(processed, REPORT_DATE);

    const priorityBySourceId = buildSourcePriorityById(sources);
    const html = renderDigestHtml({
      reportDate: REPORT_DATE,
      papers: processed.papers,
      generatedAt: processed.generatedAt,
      priorityBySourceId,
    });

    assertDigestHtml(html, processed);
  });
});
