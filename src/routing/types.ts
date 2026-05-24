import type { LifeScienceRoutingVerdict, Paper } from "../types.js";

export type BroadScienceRoutingInput = {
  id: string;
  title: string;
  journal: string;
  source_id: string;
};

export type ExcludedPaper = {
  paper: Paper;
  reason: "life-science-routing";
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

export type LifeScienceRoutingResult = {
  enabled: boolean;
  included: Paper[];
  excluded: ExcludedPaper[];
  stats: LifeScienceRoutingStats;
};
