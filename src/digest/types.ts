import type { ClassifiedPaper, SourceScope } from "../types.js";
import type { DigestLine } from "../types.js";

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

export type DigestTaggingStats = {
  llmClassified: number;
  llmTagged: number;
  fallback: number;
};

export type DigestSummarizeStats = {
  requested: number;
  llmSummarized: number;
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
