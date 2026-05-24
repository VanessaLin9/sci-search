import { loadEnvFile } from "./loadEnv.js";
import { loadSources, loadKeywords } from "./config.js";

loadEnvFile();
import { defaultReportDateInTaipei, todayInTaipei } from "./date.js";
import {
  isDebugEnabled,
  logClassifiedSample,
  logEnrichSummary,
  logRoutingSummary,
  logRunHeader,
  logSectionSummary,
  logSourceDetails,
  logSourceSummary,
} from "./debug.js";
import { runPipeline } from "./pipeline.js";
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
    scopeBySourceId,
  });

  for (const sourceResult of result.sourceResults) {
    logSourceSummary(sourceResult.stats);
    if (isDebugEnabled()) {
      logSourceDetails(sourceResult.stats, sourceResult.normalized);
    }
  }

  if (result.routing.enabled) {
    logRouting(
      `before enrich: ${result.routing.included.length} to enrich, ${result.routing.excluded.length} skipped`,
    );
  }
  logRoutingSummary(result.routing.stats, result.routing.enabled);
  logEnrichSummary(result.enrich);

  if (isDebugEnabled()) {
    logClassifiedSample(result.papers);
  }
  logSectionSummary(result.papers);

  const outputPath = `data/processed/${reportDate}/papers.json`;
  await writeJsonFile(outputPath, {
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: result.papers,
    routing: {
      enabled: result.routing.enabled,
      stats: result.routing.stats,
    },
    excludedPapers: result.routing.excluded.length > 0 ? result.routing.excluded : undefined,
  });

  console.log(
    `Wrote ${outputPath} (${result.papers.length} papers` +
      (result.routing.excluded.length > 0
        ? `, ${result.routing.excluded.length} routing-excluded`
        : "") +
      ")",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
