import type { LifeScienceRoutingVerdict } from "../types.js";
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
};

export type LifeScienceRoutingStats = {
  total: number;
  passedByScope: number;
  llmClassified: number;
  llmYes: number;
  llmNotSure: number;
  llmNo: number;
  included: number;
  excluded: number;
};

export type LifeScienceRoutingResult<P = Paper> = {
  enabled: boolean;
  included: P[];
  excluded: ExcludedPaper<P>[];
  stats: LifeScienceRoutingStats;
};
