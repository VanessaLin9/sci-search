import type { LifeScienceRoutingMethod, LifeScienceRoutingVerdict } from "../types.js";
import type { Paper } from "../../../types.js";
import { LIFE_SCIENCE_ROUTING_EXCLUSION_REASON } from "../constants.js";

export type BroadScienceRoutingInput = {
  id: string;
  title: string;
  journal: string;
  source_id: string;
};

export type ExcludedPaper<P = Paper> = {
  paper: P;
  reason: typeof LIFE_SCIENCE_ROUTING_EXCLUSION_REASON;
  verdict: Extract<LifeScienceRoutingVerdict, "no">;
  method?: LifeScienceRoutingMethod;
};

export type LifeScienceRoutingStats = {
  total: number;
  passedByScope: number;
  llmClassified: number;
  llmYes: number;
  llmNotSure: number;
  llmNo: number;
  keywordFallbackClassified: number;
  keywordFallbackYes: number;
  keywordFallbackNo: number;
  included: number;
  excluded: number;
};

export type BroadScienceMergeResult<P> = {
  included: P[];
  excluded: ExcludedPaper<P>[];
  llmYes: number;
  llmNotSure: number;
  llmNo: number;
  keywordFallbackYes: number;
  keywordFallbackNo: number;
};

export type LifeScienceRoutingResult<P = Paper> = {
  enabled: boolean;
  included: P[];
  excluded: ExcludedPaper<P>[];
  stats: LifeScienceRoutingStats;
};
