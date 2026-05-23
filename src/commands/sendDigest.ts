import { loadEnvFile } from "../loadEnv.js";

loadEnvFile();

import { defaultReportDateInTaipei } from "../date.js";
import { sendDigestEmail } from "../email/sendDigest.js";
import { processedPapersPath, readProcessedPapersFile } from "../processedData.js";

type CliOptions = {
  reportDate?: string;
  dryRun: boolean;
};

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
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
  const reportDate = cli.reportDate ?? defaultReportDateInTaipei();
  const path = processedPapersPath(reportDate);
  const processed = await readProcessedPapersFile(path);

  if (processed.reportDate !== reportDate) {
    console.warn(
      `Warning: file reportDate=${processed.reportDate} differs from requested ${reportDate}`,
    );
  }

  const result = await sendDigestEmail({
    reportDate,
    papers: processed.papers,
    generatedAt: processed.generatedAt,
    dryRun: cli.dryRun,
  });

  if (result.dryRun) {
    console.log(`[dry-run] Would send "${result.subject}"`);
    console.log(`[dry-run] To: ${result.to.join(", ")}`);
    console.log(`[dry-run] ${result.paperCount} papers from ${path}`);
    return;
  }

  console.log(`Sent "${result.subject}"`);
  console.log(`To: ${result.to.join(", ")}`);
  console.log(`Resend email id: ${result.emailId}`);
  console.log(`${result.paperCount} papers from ${path}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
