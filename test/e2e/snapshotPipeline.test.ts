import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildSourcePriorityById } from "../../src/digest/selectFeatured.js";
import { renderDigestHtml } from "../../src/email/renderDigestHtml.js";
import { loadKeywords, loadSources } from "../../src/config.js";
import { runPipeline } from "../../src/pipeline.js";
import { buildSourceScopeById } from "../../src/routing/sourceScope.js";
import {
  assertBusyDayDigestHtml,
  assertEmptyDigestHtml,
  assertEmptyPipelineOutput,
  assertSnapshotBusyDayOutput,
} from "../helpers/assertAcceptance.js";
import { buildProcessedFile, installPipelineTestEnv } from "../helpers/pipelineTestEnv.js";
import { createMockFetch } from "../helpers/mockFetch.js";
import { expectedOnReportDatePaperCount } from "../helpers/rssSnapshots.js";

const BUSY_DATE = "2026-05-22";
const EMPTY_DATE = "2026-05-24";

let originalFetch: typeof fetch;

function installMockFetch(reportDate: string) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({ reportDate }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("RSS snapshot pipeline e2e", () => {
  describe("2026-05-22 busy day", () => {
    before(() => {
      installPipelineTestEnv();
      installMockFetch(BUSY_DATE);
    });

    after(() => {
      restoreFetch();
    });

    it("runs full pipeline from frozen feeds with featured 12 and overflow", async () => {
      const sources = await loadSources();
      const keywords = await loadKeywords();
      const scopeBySourceId = buildSourceScopeById(sources);
      const manifestPaperCount = expectedOnReportDatePaperCount(BUSY_DATE);
      const minPapers = Math.max(30, Math.floor(manifestPaperCount * 0.75));

      const result = await runPipeline({
        sources,
        keywords,
        reportDate: BUSY_DATE,
        scopeBySourceId,
        biorxivSourceIds: [],
      });

      const processed = buildProcessedFile(BUSY_DATE, result);
      assertSnapshotBusyDayOutput(processed, BUSY_DATE, { minPapers });

      const html = renderDigestHtml({
        reportDate: BUSY_DATE,
        papers: processed.papers,
        generatedAt: processed.generatedAt,
        priorityBySourceId: buildSourcePriorityById(sources),
      });

      assertBusyDayDigestHtml(html, processed);
    });
  });

  describe("2026-05-24 empty day", () => {
    before(() => {
      installPipelineTestEnv();
      installMockFetch(EMPTY_DATE);
    });

    after(() => {
      restoreFetch();
    });

    it("runs full pipeline with zero papers and empty digest HTML", async () => {
      const sources = await loadSources();
      const keywords = await loadKeywords();
      const scopeBySourceId = buildSourceScopeById(sources);

      assert.equal(expectedOnReportDatePaperCount(EMPTY_DATE), 0);

      const result = await runPipeline({
        sources,
        keywords,
        reportDate: EMPTY_DATE,
        scopeBySourceId,
        biorxivSourceIds: [],
      });

      const processed = buildProcessedFile(EMPTY_DATE, result);
      assertEmptyPipelineOutput(processed, EMPTY_DATE);

      const html = renderDigestHtml({
        reportDate: EMPTY_DATE,
        papers: processed.papers,
        generatedAt: processed.generatedAt,
        priorityBySourceId: buildSourcePriorityById(sources),
      });

      assertEmptyDigestHtml(html, EMPTY_DATE);
    });
  });
});
