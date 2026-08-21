import type { DigestLine } from "../types.js";

/** Featured sort priority within a pool / email section (INV-036). */
export const DIGEST_LINE_RANK: Record<DigestLine, number> = {
  "line-a": 0,
  "line-b": 1,
  preprint: 2,
  skip: 99,
};

export type DigestSelectionStats = {
  total: number;
  candidates: number;
  featured: number;
  overflow: number;
  lineA: number;
  lineB: number;
  preprint: number;
  skip: number;
  featuredLineA: number;
  featuredLineB: number;
  featuredPreprint: number;
  overflowLineA: number;
  overflowLineB: number;
  overflowPreprint: number;
};

/**
 * Log-only diagnostics（PR #27）：不可寫進 persisted `digest.selection`，
 * 以免破壞歷史 papers.json 的 zod schema。
 */
export type DigestSelectionDiagnostics = {
  featuredIneligibleMissingAbstract: number;
};

export function buildSourcePriorityById(
  sources: ReadonlyArray<{ id: string; priority: number }>,
): ReadonlyMap<string, number> {
  return new Map(sources.map((source) => [source.id, source.priority]));
}

type RankedPaper = {
  id: string;
  sourceId: string;
  title: string;
  digestLine?: DigestLine;
  featured?: boolean;
  abstract?: string;
};

/**
 * Featured 資格（PR #27）：非 skip 且有 trimmed 英文 abstract。
 * summarize 失敗時 renderer 需靠 abstract 回退；缺摘要只降為 overflow，不改 routing。
 */
export function isEligibleForFeatured(paper: RankedPaper): boolean {
  return Boolean(paper.digestLine && paper.digestLine !== "skip" && paper.abstract?.trim());
}

export function compareSourcePriorityThenTitle(
  a: RankedPaper,
  b: RankedPaper,
  priorityBySourceId: ReadonlyMap<string, number>,
): number {
  const priorityA = priorityBySourceId.get(a.sourceId) ?? 999;
  const priorityB = priorityBySourceId.get(b.sourceId) ?? 999;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return a.title.localeCompare(b.title);
}

/** Same ordering as legacy featured sort (line → source priority → title). */
export function compareForFeatured(
  a: RankedPaper,
  b: RankedPaper,
  priorityBySourceId: ReadonlyMap<string, number>,
): number {
  const lineA = a.digestLine ?? "skip";
  const lineB = b.digestLine ?? "skip";
  const lineDiff = DIGEST_LINE_RANK[lineA] - DIGEST_LINE_RANK[lineB];
  if (lineDiff !== 0) return lineDiff;
  return compareSourcePriorityThenTitle(a, b, priorityBySourceId);
}

/** Same ordering as featured selection (line → source priority → title). */
export function sortPapersByDigestRank<P extends RankedPaper>(
  papers: P[],
  priorityBySourceId: ReadonlyMap<string, number>,
): P[] {
  return [...papers].sort((a, b) => compareForFeatured(a, b, priorityBySourceId));
}

function sortPoolByPriority<P extends RankedPaper>(
  papers: P[],
  priorityBySourceId: ReadonlyMap<string, number>,
): P[] {
  return [...papers].sort((a, b) => compareSourcePriorityThenTitle(a, b, priorityBySourceId));
}

/**
 * Featured selection：分開 A / B / preprint pool，依序填滿最多 maxFeatured。
 * - 先 A（journal/source priority）
 * - A 不足再 B 補
 * - A+B 仍不足才用 preprint 補差額；preprint 不得取代已入選 A/B
 * - 缺 abstract 者不合格，留在 overflow（PR #27）
 */
export function selectFeatured<P extends RankedPaper>(
  papers: P[],
  options: {
    maxFeatured: number;
    priorityBySourceId: ReadonlyMap<string, number>;
  },
): {
  papers: Array<P & { featured: boolean }>;
  stats: DigestSelectionStats;
  diagnostics: DigestSelectionDiagnostics;
} {
  const candidates = papers.filter((paper) => paper.digestLine && paper.digestLine !== "skip");
  const eligible = candidates.filter(isEligibleForFeatured);
  const featuredIneligibleMissingAbstract = candidates.length - eligible.length;

  const poolA = sortPoolByPriority(
    eligible.filter((paper) => paper.digestLine === "line-a"),
    options.priorityBySourceId,
  );
  const poolB = sortPoolByPriority(
    eligible.filter((paper) => paper.digestLine === "line-b"),
    options.priorityBySourceId,
  );
  const poolPreprint = sortPoolByPriority(
    eligible.filter((paper) => paper.digestLine === "preprint"),
    options.priorityBySourceId,
  );

  const featuredIds = new Set<string>();
  for (const pool of [poolA, poolB, poolPreprint]) {
    for (const paper of pool) {
      if (featuredIds.size >= options.maxFeatured) break;
      featuredIds.add(paper.id);
    }
    if (featuredIds.size >= options.maxFeatured) break;
  }

  const lineCounts = { lineA: 0, lineB: 0, preprint: 0, skip: 0 };
  const featuredByLine = { featuredLineA: 0, featuredLineB: 0, featuredPreprint: 0 };
  const overflowByLine = { overflowLineA: 0, overflowLineB: 0, overflowPreprint: 0 };

  for (const paper of papers) {
    const line = paper.digestLine ?? "skip";
    if (line === "line-a") lineCounts.lineA += 1;
    else if (line === "line-b") lineCounts.lineB += 1;
    else if (line === "preprint") lineCounts.preprint += 1;
    else lineCounts.skip += 1;
  }

  for (const paper of candidates) {
    const featured = featuredIds.has(paper.id);
    const line = paper.digestLine ?? "skip";
    if (line === "line-a") {
      if (featured) featuredByLine.featuredLineA += 1;
      else overflowByLine.overflowLineA += 1;
    } else if (line === "line-b") {
      if (featured) featuredByLine.featuredLineB += 1;
      else overflowByLine.overflowLineB += 1;
    } else if (line === "preprint") {
      if (featured) featuredByLine.featuredPreprint += 1;
      else overflowByLine.overflowPreprint += 1;
    }
  }

  const updated = papers.map((paper) => ({
    ...paper,
    featured: featuredIds.has(paper.id),
  }));

  return {
    papers: updated,
    stats: {
      total: papers.length,
      candidates: candidates.length,
      featured: featuredIds.size,
      overflow: Math.max(0, candidates.length - featuredIds.size),
      ...lineCounts,
      ...featuredByLine,
      ...overflowByLine,
    },
    diagnostics: {
      featuredIneligibleMissingAbstract,
    },
  };
}
