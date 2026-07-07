import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePruneRetentionCliArgs,
  runPruneRetention,
  type PruneRetentionCliOptions,
} from "../../src/commands/pruneRetention.js";
import type { RetentionPrunePlan } from "../../src/retention/dailyOutputRetention.js";

const samplePlan: RetentionPrunePlan = {
  baseDate: "2026-07-06",
  days: 30,
  oldestKeepDate: "2026-06-07",
  processedDatesToRemove: ["2026-06-06"],
  archiveDatesToRemove: ["2026-06-06"],
};

describe("prune-retention CLI", () => {
  it("parsePruneRetentionCliArgs reads --dry-run alongside date and days", () => {
    const cli = parsePruneRetentionCliArgs([
      "--date",
      "2026-07-06",
      "--days",
      "30",
      "--dry-run",
    ]);

    assert.equal(cli.baseDate, "2026-07-06");
    assert.equal(cli.days, 30);
    assert.equal(cli.dryRun, true);
  });

  it("runPruneRetention skips apply when dry-run is enabled", async () => {
    let applyCalls = 0;
    const cli: PruneRetentionCliOptions = {
      baseDate: "2026-07-06",
      days: 30,
      dryRun: true,
    };

    const result = await runPruneRetention(cli, {
      scan: async () => samplePlan,
      apply: async () => {
        applyCalls += 1;
      },
      log: () => {},
    });

    assert.equal(applyCalls, 0);
    assert.equal(result.applied, false);
    assert.deepEqual(result.plan, samplePlan);
  });

  it("runPruneRetention applies the plan when dry-run is disabled", async () => {
    let appliedPlan: RetentionPrunePlan | undefined;
    const cli: PruneRetentionCliOptions = {
      baseDate: "2026-07-06",
      days: 30,
      dryRun: false,
    };

    const result = await runPruneRetention(cli, {
      scan: async () => samplePlan,
      apply: async (plan) => {
        appliedPlan = plan;
      },
      log: () => {},
    });

    assert.equal(result.applied, true);
    assert.deepEqual(appliedPlan, samplePlan);
  });
});
