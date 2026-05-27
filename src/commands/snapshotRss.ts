import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSources } from "../config.js";
import { dedupePapers, filterPapersByDate } from "../filterPapers.js";
import { fetchRssXml } from "../fetchRss.js";
import { normalizeRssItemToPaper } from "../normalize.js";
import { DEFAULT_RSS_SOURCE_IDS } from "../pipeline.js";
import type { Source } from "../types.js";

type CliOptions = {
  reportDate: string;
  outputDir?: string;
};

type SnapshotManifestEntry = {
  sourceId: string;
  url: string;
  status: "ok" | "error";
  savedAt: string;
  rssItemCount?: number;
  normalizedCount?: number;
  onReportDateCount?: number;
  bytes?: number;
  error?: string;
};

type SnapshotManifest = {
  reportDate: string;
  snapshotAt: string;
  sources: SnapshotManifestEntry[];
};

function parseCliArgs(argv: string[]): CliOptions {
  let reportDate: string | undefined;
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date" && argv[index + 1]) {
      reportDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      reportDate = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--out" && argv[index + 1]) {
      outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      outputDir = arg.slice("--out=".length);
    }
  }

  if (!reportDate) {
    throw new Error("Missing required --date YYYY-MM-DD");
  }

  return {
    reportDate,
    outputDir: outputDir ?? join("test", "fixtures", "rss-snapshots", reportDate),
  };
}

async function snapshotOneSource(
  source: Source,
  reportDate: string,
  outputDir: string,
): Promise<SnapshotManifestEntry> {
  const savedAt = new Date().toISOString();

  try {
    const xml = await fetchRssXml(source);
    const outPath = join(outputDir, `${source.id}.xml`);
    await writeFile(outPath, xml, "utf8");

    const Parser = (await import("rss-parser")).default;
    const parser = new Parser({
      customFields: {
        item: [
          ["dc:source", "source"],
          ["content:encoded", "contentEncoded"],
        ],
      },
    });
    const feed = await parser.parseString(xml);
    const normalized = feed.items
      .map((item) => normalizeRssItemToPaper(item, source))
      .filter((paper): paper is NonNullable<typeof paper> => paper !== null);
    const deduped = dedupePapers(normalized);
    const onReportDate = filterPapersByDate(deduped, reportDate);

    return {
      sourceId: source.id,
      url: source.url,
      status: "ok",
      savedAt,
      rssItemCount: feed.items.length,
      normalizedCount: normalized.length,
      onReportDateCount: onReportDate.length,
      bytes: Buffer.byteLength(xml, "utf8"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sourceId: source.id,
      url: source.url,
      status: "error",
      savedAt,
      error: message,
    };
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const sources = await loadSources();
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  await mkdir(cli.outputDir!, { recursive: true });

  const entries: SnapshotManifestEntry[] = [];

  for (const sourceId of DEFAULT_RSS_SOURCE_IDS) {
    const source = sourceById.get(sourceId);
    if (!source) {
      throw new Error(`Source ${sourceId} not found in config/sources.json`);
    }
    if (source.kind !== "rss") {
      continue;
    }

    console.log(`[snapshot] ${sourceId} ← ${source.url}`);
    const entry = await snapshotOneSource(source, cli.reportDate, cli.outputDir!);
    entries.push(entry);

    if (entry.status === "ok") {
      console.log(
        `  saved ${entry.bytes} bytes · items ${entry.rssItemCount} · on ${cli.reportDate}: ${entry.onReportDateCount}`,
      );
    } else {
      console.warn(`  failed: ${entry.error}`);
    }
  }

  const manifest: SnapshotManifest = {
    reportDate: cli.reportDate,
    snapshotAt: new Date().toISOString(),
    sources: entries,
  };

  const manifestPath = join(cli.outputDir!, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const okCount = entries.filter((entry) => entry.status === "ok").length;
  const onReportDateTotal = entries.reduce(
    (sum, entry) => sum + (entry.onReportDateCount ?? 0),
    0,
  );

  console.log("");
  console.log(`Wrote ${okCount}/${entries.length} feeds to ${cli.outputDir}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Papers on ${cli.reportDate} (from current feed): ${onReportDateTotal}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
