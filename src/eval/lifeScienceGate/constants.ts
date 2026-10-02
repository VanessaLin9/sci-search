export const LIFE_SCIENCE_GATE_DATASET_ID = "life-science-gate" as const;

export const LIFE_SCIENCE_GATE_POLICY_ID = "life-science-routing-title-only-v1" as const;

/** 獨立於會被 prune 的 `data/processed/{date}/`（PR #42）。 */
export const DEFAULT_DATASET_PATH = "eval/life-science-gate/v1/dataset.json" as const;

export const ROUTING_VERDICTS = ["yes", "no", "not_sure"] as const;

export const SAMPLE_GROUPS = ["general", "hard"] as const;

export const DATASET_SPLITS = ["dev", "eval"] as const;

export const ANNOTATION_STATUSES = ["pending_review", "reviewed", "disputed"] as const;

export const HARD_TAGS = [
  "interdisciplinary",
  "vague_title",
  "news_commentary",
  "historical_disagreement",
  "keyword_fallback",
] as const;

export const PROVENANCE_KINDS = ["historical_processed", "reconstructed"] as const;

export const PREDICTION_ERROR_KINDS = [
  "timeout",
  "http_429",
  "http_5xx",
  "empty",
  "malformed",
  "missing",
  "other",
] as const;

export const HISTORICAL_METHODS = ["llm", "routing-keyword-fallback"] as const;
