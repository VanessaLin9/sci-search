import { describe, it } from "node:test";
import { buildSourcePriorityById } from "../../src/digest/selectFeatured.js";
import { renderDigestHtml } from "../../src/email/renderDigestHtml.js";
import { loadSources } from "../../src/config.js";
import {
  assertBusyDayDigestHtml,
  assertEmptyDigestHtml,
  assertRegressionFixtureOutput,
} from "../helpers/assertAcceptance.js";
import {
  loadRegressionFixture,
  REGRESSION_EXPECTATIONS,
} from "../helpers/regressionFixtures.js";

describe("regression render digest", () => {
  it("2026-05-22: validates fixture and renders busy-day HTML", async () => {
    const reportDate = "2026-05-22";
    const processed = loadRegressionFixture(reportDate);
    const expected = REGRESSION_EXPECTATIONS[reportDate]!;

    assertRegressionFixtureOutput(processed, expected);

    const sources = await loadSources();
    const html = renderDigestHtml({
      reportDate,
      papers: processed.papers,
      generatedAt: processed.generatedAt,
      priorityBySourceId: buildSourcePriorityById(sources),
    });

    assertBusyDayDigestHtml(html, processed);
  });

  it("2026-05-24: validates empty fixture and renders empty-day HTML", async () => {
    const reportDate = "2026-05-24";
    const processed = loadRegressionFixture(reportDate);
    const expected = REGRESSION_EXPECTATIONS[reportDate]!;

    assertRegressionFixtureOutput(processed, expected);

    const sources = await loadSources();
    const html = renderDigestHtml({
      reportDate,
      papers: processed.papers,
      generatedAt: processed.generatedAt,
      priorityBySourceId: buildSourcePriorityById(sources),
    });

    assertEmptyDigestHtml(html, reportDate);
  });
});
