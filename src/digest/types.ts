import type { ClassifiedPaper, SourceScope } from "../types.js";
import type { DigestLine } from "../types.js";
import type { DigestTaggingStats as DomainDigestTaggingStats } from "../domain/life-science/digest/resolveDigestLines.js";
import type { DigestSelectionStats as DomainDigestSelectionStats } from "../domain/life-science/digest/selection.js";

export type DigestTaggingInput = {
  id: string;
  title: string;
  journal: string;
  source_id: string;
  scope: SourceScope;
  abstract?: string;
};

export type DigestSummarizeInput = {
  id: string;
  title: string;
  journal: string;
  source_id: string;
  scope: SourceScope;
  digest_line: DigestLine;
  abstract?: string;
};

export type DigestTranslateInput = {
  id: string;
  title: string;
  journal: string;
};

export type DigestSelectionStats = DomainDigestSelectionStats;

/** Spatial classifier stats（field name `tagging` kept for persisted digest schema continuity）. */
export type DigestTaggingStats = DomainDigestTaggingStats;

export type DigestSummarizeStats = {
  requested: number;
  /** primarySucceeded + fallbackSucceeded；舊消費者可只看此欄（PR #30）。 */
  llmSummarized: number;
  /** Primary model 成功篇數（PR #30）。 */
  primarySucceeded: number;
  /** Fallback model 補回篇數（PR #30）。 */
  fallbackSucceeded: number;
  failed: number;
};

export type DigestTranslateStats = {
  requested: number;
  llmTranslated: number;
  failed: number;
};

export type DigestPhaseResult = {
  enabled: boolean;
  llmTagging: boolean;
  papers: ClassifiedPaper[];
  tagging: DigestTaggingStats;
  selection: DigestSelectionStats;
  summarize: DigestSummarizeStats;
  translate: DigestTranslateStats;
};
