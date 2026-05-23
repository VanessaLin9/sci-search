import { loadEnvFile } from "./loadEnv.js";
import { loadSources, loadKeywords } from "./config.js";

loadEnvFile();
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

function parseReportDateArg(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date" && argv[index + 1]) return argv[index + 1];
    if (arg.startsWith("--date=")) return arg.slice("--date=".length);
  }
  return undefined;
}

async function main() {
  const today = todayInTaipei();
  const reportDate = parseReportDateArg(process.argv.slice(2)) ?? defaultReportDateInTaipei();
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
