import type { DigestLine } from "../types.js";

/** Featured sort priority: line-a < line-b < preprint < skip (INV-036). */
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

export function compareForFeatured(
  a: RankedPaper,
  b: RankedPaper,
  priorityBySourceId: ReadonlyMap<string, number>,
): number {
  const lineA = a.digestLine ?? "skip";
  const lineB = b.digestLine ?? "skip";
  const lineDiff = DIGEST_LINE_RANK[lineA] - DIGEST_LINE_RANK[lineB];
  if (lineDiff !== 0) return lineDiff;

  const priorityA = priorityBySourceId.get(a.sourceId) ?? 999;
  const priorityB = priorityBySourceId.get(b.sourceId) ?? 999;
  if (priorityA !== priorityB) return priorityA - priorityB;

  return a.title.localeCompare(b.title);
}

/** Same ordering as featured selection (line → source priority → title). */
export function sortPapersByDigestRank<P extends RankedPaper>(
  papers: P[],
  priorityBySourceId: ReadonlyMap<string, number>,
): P[] {
  return [...papers].sort((a, b) => compareForFeatured(a, b, priorityBySourceId));
}

export function selectFeatured<P extends RankedPaper>(
  papers: P[],
  options: {
    maxFeatured: number;
    priorityBySourceId: ReadonlyMap<string, number>;
  },
): {
  papers: P[];
  stats: DigestSelectionStats;
  diagnostics: DigestSelectionDiagnostics;
} {
  // candidates = 全部可見文；featured 只從 eligible 取前 maxFeatured（PR #27）。
  // 合格不足時寧可少於上限，也不用空摘要 paper 硬補。
  const candidates = papers.filter((paper) => paper.digestLine && paper.digestLine !== "skip");
  const sorted = [...candidates].sort((a, b) =>
    compareForFeatured(a, b, options.priorityBySourceId),
  );
  const eligible = sorted.filter(isEligibleForFeatured);
  const featuredIneligibleMissingAbstract = candidates.length - eligible.length;
  const featuredIds = new Set(eligible.slice(0, options.maxFeatured).map((paper) => paper.id));

  const lineCounts = { lineA: 0, lineB: 0, preprint: 0, skip: 0 };
  for (const paper of papers) {
    const line = paper.digestLine ?? "skip";
    if (line === "line-a") lineCounts.lineA += 1;
    else if (line === "line-b") lineCounts.lineB += 1;
    else if (line === "preprint") lineCounts.preprint += 1;
    else lineCounts.skip += 1;
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
    },
    diagnostics: {
      featuredIneligibleMissingAbstract,
    },
  };
}
