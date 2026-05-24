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
import { countPapersBySection } from "./filterPapers.js";
import { DEFAULT_RSS_SOURCE_IDS, enrichAndClassifyPapers, runPipeline } from "./pipeline.js";
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
    }
  }

  const routing = await routeLifeSciencePapers({
    papers: result.papers,
    scopeBySourceId,
  });

  if (routing.enabled) {
    logRouting(`before enrich: ${routing.included.length} to enrich, ${routing.excluded.length} skipped`);
  }
  logRoutingSummary(routing.stats, routing.enabled);

  const { papers: classified, enrichedCount, enrichExcludedCount } =
    await enrichAndClassifyPapers(routing.included, keywords);

  if (enrichedCount > 0 || enrichExcludedCount > 0) {
    const enrichExcluded =
      enrichExcludedCount > 0 ? `, ${enrichExcludedCount} excluded by enrich` : "";
    console.log(`Enriched ${enrichedCount} abstract(s)${enrichExcluded}`);
  }

  if (isDebugEnabled()) {
    logClassifiedSample(classified);
  }

  const sections = countPapersBySection(classified);
  console.log(
    `Sections: ${Object.entries(sections)
      .map(([section, count]) => `${section}: ${count}`)
      .join(", ")}`,
  );

  const outputPath = `data/processed/${reportDate}/papers.json`;
  await writeJsonFile(outputPath, {
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: classified,
    routing: {
      enabled: routing.enabled,
      stats: routing.stats,
    },
    excludedPapers: routing.excluded.length > 0 ? routing.excluded : undefined,
  });

  console.log(
    `Wrote ${outputPath} (${classified.length} papers` +
      (routing.excluded.length > 0 ? `, ${routing.excluded.length} routing-excluded` : "") +
      ")",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
