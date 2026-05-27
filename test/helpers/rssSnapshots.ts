import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/rss-snapshots");

type SnapshotManifestEntry = {
  sourceId: string;
  url: string;
  status: "ok" | "error";
  onReportDateCount?: number;
};

type SnapshotManifest = {
  reportDate: string;
  sources: SnapshotManifestEntry[];
};

export function rssSnapshotDir(reportDate: string): string {
  return join(SNAPSHOTS_ROOT, reportDate);
}

export function hasRssSnapshots(reportDate: string): boolean {
  return existsSync(join(rssSnapshotDir(reportDate), "manifest.json"));
}

/** Map feed URL → path to frozen XML for a report date. */
export function loadRssSnapshotUrlMap(reportDate: string): ReadonlyMap<string, string> {
  const manifestPath = join(rssSnapshotDir(reportDate), "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No RSS snapshots for ${reportDate}. Run: npm run snapshot-rss -- --date ${reportDate}`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  const map = new Map<string, string>();

  for (const entry of manifest.sources) {
    if (entry.status !== "ok") continue;
    const xmlPath = join(rssSnapshotDir(reportDate), `${entry.sourceId}.xml`);
    if (!existsSync(xmlPath)) {
      throw new Error(`Missing snapshot file for ${entry.sourceId} (${reportDate})`);
    }
    map.set(entry.url, xmlPath);
  }

  return map;
}

/** Sum of on-report-date items across feeds at snapshot time (before cross-source dedupe). */
export function expectedOnReportDatePaperCount(reportDate: string): number {
  const manifestPath = join(rssSnapshotDir(reportDate), "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  return manifest.sources.reduce((sum, entry) => sum + (entry.onReportDateCount ?? 0), 0);
}
