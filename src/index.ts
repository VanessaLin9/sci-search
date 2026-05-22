import { loadSources, loadKeywords } from "./config.js";
import { defaultReportDateInTaipei, todayInTaipei } from "./date.js";
import {
  isDebugEnabled,
  logClassifiedSample,
  logRunHeader,
  logSourceDetails,
  logSourceSummary,
} from "./debug.js";
import { DEFAULT_RSS_SOURCE_IDS, runPipeline } from "./pipeline.js";
import { writeJsonFile } from "./writeJson.js";

async function main() {
  const today = todayInTaipei();
  const reportDate = defaultReportDateInTaipei();
  const sources = await loadSources();
  const keywords = await loadKeywords();

  logRunHeader(today, reportDate, sources.length);

  const result = await runPipeline({
    sources,
    keywords,
    reportDate,
    rssSourceIds: DEFAULT_RSS_SOURCE_IDS,
  });

  for (const sourceResult of result.sourceResults) {
    logSourceSummary(sourceResult.stats);

    if (isDebugEnabled()) {
      logSourceDetails(sourceResult.stats, sourceResult.normalized);
      logClassifiedSample(sourceResult.papers);
    }
  }

  const outputPath = `data/processed/${reportDate}/papers.json`;
  await writeJsonFile(outputPath, {
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: result.papers,
  });

  console.log(`Wrote ${outputPath} (${result.papers.length} papers)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
