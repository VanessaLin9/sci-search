import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadRoutingKeywordsConfig } from "../../src/config.js";
import {
  mergeBroadScienceKeywordFallbackResults,
} from "../../src/domain/life-science/routing/route.js";
import { lifeScienceRoutingMethodSchema } from "../../src/domain/life-science/schemas.js";
import { validateProcessedPapersFile } from "../../src/processedData.js";
import type { Paper } from "../../src/types.js";

const config = loadRoutingKeywordsConfig();

describe("routing keyword fallback schema", () => {
  test("accepts routing-keyword-fallback on included and excluded papers", () => {
    const papers: Paper[] = [
      {
        id: "yes-1",
        sourceId: "science",
        title: "Semaglutide attenuates neuroinflammation in male mice",
        journal: "Test Journal",
        publishedDate: "2026-06-10",
        url: "https://example.test/yes-1",
      },
      {
        id: "no-1",
        sourceId: "science",
        title: "Title bs-1",
        journal: "Test Journal",
        publishedDate: "2026-06-10",
        url: "https://example.test/no-1",
      },
    ];

    const merge = mergeBroadScienceKeywordFallbackResults(papers, config);

    assert.equal(merge.included[0]?.lifeScienceRouting?.method, "routing-keyword-fallback");
    assert.equal(merge.excluded[0]?.method, "routing-keyword-fallback");
    assert.equal(lifeScienceRoutingMethodSchema.parse("routing-keyword-fallback"), "routing-keyword-fallback");

    const file = validateProcessedPapersFile({
      reportDate: "2026-06-10",
      papers: merge.included.map((paper) => ({
        ...paper,
        matchedKeywords: [],
        section: "other" as const,
      })),
      routing: {
        enabled: true,
        stats: {
          total: 2,
          passedByScope: 0,
          llmClassified: 0,
          llmYes: 0,
          llmNotSure: 0,
          llmNo: 0,
          keywordFallbackClassified: 2,
          keywordFallbackYes: 1,
          keywordFallbackNo: 1,
          included: 1,
          excluded: 1,
        },
      },
      excludedPapers: merge.excluded,
    });

    assert.equal(file.excludedPapers?.[0]?.method, "routing-keyword-fallback");
  });
});
