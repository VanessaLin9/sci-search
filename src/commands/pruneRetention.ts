import { defaultReportDateInTaipei } from "../date.js";
import {
  applyRetentionPrune,
  scanAndPlanRetentionPrune,
  type RetentionPrunePlan,
} from "../retention/dailyOutputRetention.js";

const DEFAULT_RETENTION_DAYS = 30;

type CliOptions = {
  baseDate: string;
  days: number;
  dryRun: boolean;
};

function parseCliArgs(argv: string[]): CliOptions {
  let baseDate: string | undefined;
  let days = DEFAULT_RETENTION_DAYS;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--date" && argv[index + 1]) {
      baseDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      baseDate = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--days" && argv[index + 1]) {
      days = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--days=")) {
      days = Number(arg.slice("--days=".length));
    }
  }

  return {
    baseDate: baseDate ?? defaultReportDateInTaipei(),
    days,
    dryRun,
  };
}

export function logRetentionPrunePlan(plan: RetentionPrunePlan): void {
  console.log(`[retention] baseDate=${plan.baseDate} days=${plan.days} oldestKeepDate=${plan.oldestKeepDate}`);
  if (plan.processedDatesToRemove.length === 0 && plan.archiveDatesToRemove.length === 0) {
    console.log("[retention] nothing to prune");
    return;
  }

  if (plan.processedDatesToRemove.length > 0) {
    console.log(`[retention] remove processed: ${plan.processedDatesToRemove.join(", ")}`);
  } else {
    console.log("[retention] remove processed: (none)");
  }

  if (plan.archiveDatesToRemove.length > 0) {
    console.log(`[retention] remove archive: ${plan.archiveDatesToRemove.join(", ")}`);
  } else {
    console.log("[retention] remove archive: (none)");
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const plan = await scanAndPlanRetentionPrune({
    baseDate: cli.baseDate,
    days: cli.days,
  });

  logRetentionPrunePlan(plan);
  if (cli.dryRun) {
    console.log("[retention] dry-run: no files removed");
    return;
  }

  await applyRetentionPrune(plan);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
