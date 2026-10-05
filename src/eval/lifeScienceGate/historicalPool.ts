import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SOURCE_SCOPE_BY_ID } from "../../domain/life-science/sources.js";
import type { HistoricalMethod, HistoricalObservation, RoutingVerdict } from "./types.js";

export const BROAD_SCIENCE_SOURCE_IDS = new Set(
  Object.entries(SOURCE_SCOPE_BY_ID)
    .filter(([, scope]) => scope === "broad-science")
    .map(([sourceId]) => sourceId),
);

export type HistoricalPaperRow = {
  reportDate: string;
  origin: "working-tree" | "git-history";
  path: string;
  gitCommit: string | null;
  id: string;
  doi: string;
  title: string;
  journal: string;
  sourceId: string;
  included: boolean;
  verdict: RoutingVerdict | null;
  method: HistoricalMethod | null;
  articleType?: string;
  recoverableExcluded: boolean;
};

type RawPaper = {
  id?: unknown;
  title?: unknown;
  journal?: unknown;
  doi?: unknown;
  sourceId?: unknown;
  articleType?: unknown;
  lifeScienceRouting?: { verdict?: unknown; method?: unknown };
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asMethod(value: unknown): HistoricalMethod | null {
  return value === "llm" || value === "routing-keyword-fallback" ? value : null;
}

function asVerdict(value: unknown): RoutingVerdict | null {
  return value === "yes" || value === "no" || value === "not_sure" ? value : null;
}

function collectFromProcessedFile(
  file: {
    reportDate?: unknown;
    papers?: RawPaper[];
    excludedPapers?: Array<{ paper?: RawPaper; verdict?: unknown; method?: unknown; reason?: unknown }>;
  },
  path: string,
  origin: HistoricalPaperRow["origin"],
  gitCommit: string | null,
): HistoricalPaperRow[] {
  const reportDate = asString(file.reportDate);
  const rows: HistoricalPaperRow[] = [];

  for (const paper of file.papers ?? []) {
    const row = toRow(paper, {
      reportDate,
      path,
      origin,
      gitCommit,
      included: true,
      verdict: asVerdict(paper.lifeScienceRouting?.verdict),
      method: asMethod(paper.lifeScienceRouting?.method),
      recoverableExcluded: false,
    });
    if (row) rows.push(row);
  }

  for (const excluded of file.excludedPapers ?? []) {
    if (!excluded.paper) continue;
    const row = toRow(excluded.paper, {
      reportDate,
      path,
      origin,
      gitCommit,
      included: false,
      verdict: asVerdict(excluded.verdict) ?? asVerdict(excluded.paper.lifeScienceRouting?.verdict),
      method: asMethod(excluded.method) ?? asMethod(excluded.paper.lifeScienceRouting?.method),
      recoverableExcluded: Boolean(asString(excluded.paper.title)),
    });
    if (row) rows.push(row);
  }

  return rows;
}

function toRow(
  paper: RawPaper,
  meta: Omit<HistoricalPaperRow, "id" | "doi" | "title" | "journal" | "sourceId" | "articleType">,
): HistoricalPaperRow | null {
  const sourceId = asString(paper.sourceId);
  const title = asString(paper.title).trim();
  const id = asString(paper.id);
  if (!BROAD_SCIENCE_SOURCE_IDS.has(sourceId) || !title || !id) return null;
  if (meta.method !== "llm" && meta.method !== "routing-keyword-fallback" && meta.included) {
    return null;
  }
  return {
    ...meta,
    id,
    doi: asString(paper.doi) || id,
    title,
    journal: asString(paper.journal) || "unknown",
    sourceId,
    articleType: asString(paper.articleType) || undefined,
  };
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20_000_000 }).trim();
}

function listProcessedJsonPaths(): string[] {
  return [
    ...new Set(
      gitOutput(["log", "--all", "--pretty=format:", "--name-only", "--", "data/processed"])
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /data\/processed\/\d{4}-\d{2}-\d{2}\/papers\.json$/.test(line)),
    ),
  ].sort();
}

function recoverGitFile(path: string): { gitCommit: string; raw: string } | null {
  const deleted = gitOutput(["log", "-1", "--diff-filter=D", "--pretty=%H", "--", path]);
  if (deleted) {
    const parent = `${deleted}^`;
    const raw = gitOutput(["show", `${parent}:${path}`]);
    const commit = gitOutput(["rev-parse", "--verify", parent]);
    return { gitCommit: commit, raw };
  }
  const hashes = gitOutput(["log", "--all", "--pretty=%H", "--", path])
    .split("\n")
    .filter(Boolean);
  for (const hash of hashes) {
    try {
      return { gitCommit: hash, raw: gitOutput(["show", `${hash}:${path}`]) };
    } catch {
      continue;
    }
  }
  return null;
}

export async function collectHistoricalGateRows(options?: {
  processedRoot?: string;
  includeGitHistory?: boolean;
}): Promise<HistoricalPaperRow[]> {
  const processedRoot = options?.processedRoot ?? "data/processed";
  const includeGitHistory = options?.includeGitHistory ?? true;
  const currentCommit = gitOutput(["rev-parse", "HEAD"]);
  const localDates = (await readdir(processedRoot)).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name));
  const rows: HistoricalPaperRow[] = [];

  for (const date of localDates.sort()) {
    const path = join(processedRoot, date, "papers.json");
    const file = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof collectFromProcessedFile>[0];
    rows.push(...collectFromProcessedFile(file, path, "working-tree", currentCommit));
  }

  if (!includeGitHistory) return rows;

  const localDateSet = new Set(localDates);
  for (const path of listProcessedJsonPaths()) {
    const date = path.split("/")[2];
    if (localDateSet.has(date)) continue;
    const recovered = recoverGitFile(path);
    if (!recovered) continue;
    const file = JSON.parse(recovered.raw) as Parameters<typeof collectFromProcessedFile>[0];
    rows.push(...collectFromProcessedFile(file, path, "git-history", recovered.gitCommit));
  }

  return rows;
}

export function normalizeArticleKey(doi: string, title: string): string {
  const normalizedDoi = doi.trim().toLowerCase();
  if (normalizedDoi.startsWith("10.")) return `doi:${normalizedDoi}`;
  return `title:${title.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export function groupHistoricalRows(rows: HistoricalPaperRow[]): Map<string, HistoricalPaperRow[]> {
  const groups = new Map<string, HistoricalPaperRow[]>();
  for (const row of rows) {
    const key = normalizeArticleKey(row.doi, row.title);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

export function observationsFromRows(rows: HistoricalPaperRow[]): HistoricalObservation[] {
  return [...rows]
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate))
    .map((row) => ({
      reportDate: row.reportDate,
      included: row.included,
      verdict: row.verdict,
      method: row.method,
      path: row.path,
      gitCommit: row.gitCommit,
    }));
}
