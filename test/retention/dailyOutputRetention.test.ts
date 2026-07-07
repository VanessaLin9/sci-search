import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyRetentionPrune,
  computeOldestKeepDate,
  isRetentionDateLabel,
  planRetentionPruneFromEntries,
  scanAndPlanRetentionPrune,
  shouldPruneRetentionDate,
} from "../../src/retention/dailyOutputRetention.js";

describe("daily output retention", () => {
  it("computeOldestKeepDate keeps base date and prior days-1 calendar days", () => {
    assert.equal(computeOldestKeepDate("2026-07-06", 30), "2026-06-07");
    assert.equal(computeOldestKeepDate("2026-07-06", 1), "2026-07-06");
  });

  it("isRetentionDateLabel accepts YYYY-MM-DD and rejects invalid labels", () => {
    assert.equal(isRetentionDateLabel("2026-06-07"), true);
    assert.equal(isRetentionDateLabel("index.html"), false);
    assert.equal(isRetentionDateLabel("2026-13-01"), false);
    assert.equal(isRetentionDateLabel("notes"), false);
  });

  it("shouldPruneRetentionDate removes dates before the 30-day window", () => {
    const baseDate = "2026-07-06";
    const days = 30;

    assert.equal(shouldPruneRetentionDate("2026-06-06", baseDate, days), true);
    assert.equal(shouldPruneRetentionDate("2026-06-07", baseDate, days), false);
    assert.equal(shouldPruneRetentionDate("2026-07-06", baseDate, days), false);
  });

  it("shouldPruneRetentionDate does not prune future dates", () => {
    assert.equal(shouldPruneRetentionDate("2026-07-07", "2026-07-06", 30), false);
  });

  it("shouldPruneRetentionDate ignores non-date labels", () => {
    assert.equal(shouldPruneRetentionDate("index.html", "2026-07-06", 30), false);
  });

  it("planRetentionPruneFromEntries lists processed and archive dates to remove", () => {
    const plan = planRetentionPruneFromEntries({
      baseDate: "2026-07-06",
      days: 30,
      processedDateLabels: ["2026-06-06", "2026-06-07", "2026-07-06", "notes"],
      archiveDateLabels: ["2026-06-06", "2026-06-07", "2026-07-07"],
    });

    assert.equal(plan.baseDate, "2026-07-06");
    assert.equal(plan.days, 30);
    assert.equal(plan.oldestKeepDate, "2026-06-07");
    assert.deepEqual(plan.processedDatesToRemove, ["2026-06-06"]);
    assert.deepEqual(plan.archiveDatesToRemove, ["2026-06-06"]);
  });

  it("scanAndPlanRetentionPrune ignores non-date entries and index.html", async () => {
    const root = await mkdtemp(join(tmpdir(), "paper-retention-"));
    const processedRoot = join(root, "data", "processed");
    const archiveRoot = join(root, "docs", "archive");

    try {
      await mkdir(join(processedRoot, "2026-06-06"), { recursive: true });
      await mkdir(join(processedRoot, "2026-06-07"), { recursive: true });
      await mkdir(join(processedRoot, "notes"), { recursive: true });
      await mkdir(archiveRoot, { recursive: true });
      await writeFile(join(archiveRoot, "2026-06-06.html"), "<html></html>");
      await writeFile(join(archiveRoot, "2026-06-07.html"), "<html></html>");
      await writeFile(join(archiveRoot, "index.html"), "<html></html>");

      const plan = await scanAndPlanRetentionPrune({
        baseDate: "2026-07-06",
        days: 30,
        processedRoot,
        archiveRoot,
      });

      assert.deepEqual(plan.processedDatesToRemove, ["2026-06-06"]);
      assert.deepEqual(plan.archiveDatesToRemove, ["2026-06-06"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applyRetentionPrune removes planned directories and archive files only", async () => {
    const root = await mkdtemp(join(tmpdir(), "paper-retention-"));
    const processedRoot = join(root, "data", "processed");
    const archiveRoot = join(root, "docs", "archive");

    try {
      await mkdir(join(processedRoot, "2026-06-06"), { recursive: true });
      await mkdir(join(processedRoot, "2026-06-07"), { recursive: true });
      await mkdir(archiveRoot, { recursive: true });
      await writeFile(join(archiveRoot, "2026-06-06.html"), "<html></html>");
      await writeFile(join(archiveRoot, "2026-06-07.html"), "<html></html>");
      await writeFile(join(root, "docs", "index.html"), "<html></html>");

      const plan = await scanAndPlanRetentionPrune({
        baseDate: "2026-07-06",
        days: 30,
        processedRoot,
        archiveRoot,
      });

      await applyRetentionPrune(plan, { processedRoot, archiveRoot });

      const processedEntries = await readdir(processedRoot);
      const archiveEntries = await readdir(archiveRoot);

      assert.deepEqual(processedEntries.sort(), ["2026-06-07"]);
      assert.deepEqual(archiveEntries.sort(), ["2026-06-07.html"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
