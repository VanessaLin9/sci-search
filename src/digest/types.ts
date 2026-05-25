import type { ClassifiedPaper, SourceScope } from "../types.js";

export type DigestTaggingInput = {
  id: string;
  title: string;
  journal: string;
  source_id: string;
  scope: SourceScope;
  abstract?: string;
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

export type DigestPhaseResult = {
  enabled: boolean;
  llmTagging: boolean;
  papers: ClassifiedPaper[];
  tagging: DigestTaggingStats;
  selection: DigestSelectionStats;
};
