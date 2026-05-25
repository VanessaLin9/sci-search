import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadEnvFile } from "../loadEnv.js";

loadEnvFile();

import { loadSources } from "../config.js";
import { defaultReportDateInTaipei } from "../date.js";
import { buildSourcePriorityById } from "../digest/selectFeatured.js";
import { renderDigestHtml } from "../email/renderDigestHtml.js";
import { processedPapersPath, readProcessedPapersFile } from "../processedData.js";

type CliOptions = {
  reportDate?: string;
  output?: string;
  archive: boolean;
};

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { archive: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-archive") {
      options.archive = false;
      continue;
    }
    if (arg === "--date" && argv[index + 1]) {
      options.reportDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.reportDate = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--output" && argv[index + 1]) {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    }
  }

  return options;
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const reportDate = cli.reportDate ?? defaultReportDateInTaipei();
  const processedPath = processedPapersPath(reportDate);
  const processed = await readProcessedPapersFile(processedPath);

  if (processed.reportDate !== reportDate) {
    console.warn(
      `Warning: file reportDate=${processed.reportDate} differs from requested ${reportDate}`,
    );
  }

  const sources = await loadSources();
  const html = renderDigestHtml({
    reportDate,
    papers: processed.papers,
    generatedAt: processed.generatedAt,
    priorityBySourceId: buildSourcePriorityById(sources),
  });

  const indexPath = cli.output ?? join("docs", "index.html");
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, html, "utf8");
  console.log(`Wrote ${indexPath} (${html.length} chars)`);

  if (cli.archive) {
    const archivePath = join("docs", "archive", `${reportDate}.html`);
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, html, "utf8");
    console.log(`Wrote ${archivePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
