import { loadEnvFile } from "./loadEnv.js";
import { loadSources, loadKeywords } from "./config.js";

loadEnvFile();
import { defaultReportDateInTaipei, todayInTaipei } from "./date.js";
import {
  isDebugEnabled,
  logClassifiedSample,
  logRoutingSummary,
  logRunHeader,
  logSourceDetails,
  logSourceSummary,
} from "./debug.js";
import { DEFAULT_RSS_SOURCE_IDS, runPipeline } from "./pipeline.js";
import { isLifeScienceRoutingEnabled } from "./routing/config.js";
import { routeLifeSciencePapers } from "./routing/routeLifeScience.js";
import { logRouting } from "./routing/routingLog.js";
import { buildSourceScopeById } from "./routing/sourceScope.js";
import { writeJsonFile } from "./writeJson.js";

type CliOptions = {
  reportDate?: string;
};

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date" && argv[index + 1]) {
      options.reportDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.reportDate = arg.slice("--date=".length);
    }
  }

  return options;
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const today = todayInTaipei();
  const reportDate = cli.reportDate ?? defaultReportDateInTaipei();
  const sources = await loadSources();
  const keywords = await loadKeywords();
  const scopeBySourceId = buildSourceScopeById(sources);

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

  if (isLifeScienceRoutingEnabled()) {
    logRouting(`starting after collect (${result.papers.length} papers on report date)`);
  }

  const routing = await routeLifeSciencePapers({
    papers: result.papers,
    scopeBySourceId,
  });
  logRoutingSummary(routing.stats, routing.enabled);

  const outputPath = `data/processed/${reportDate}/papers.json`;
  await writeJsonFile(outputPath, {
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: routing.included,
    routing: {
      enabled: routing.enabled,
      stats: routing.stats,
    },
    excludedPapers: routing.excluded.length > 0 ? routing.excluded : undefined,
  });

  console.log(
    `Wrote ${outputPath} (${routing.included.length} papers` +
      (routing.excluded.length > 0 ? `, ${routing.excluded.length} excluded` : "") +
      ")",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
