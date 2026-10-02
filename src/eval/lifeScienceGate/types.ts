import type {
  ANNOTATION_STATUSES,
  DATASET_SPLITS,
  HARD_TAGS,
  HISTORICAL_METHODS,
  PREDICTION_ERROR_KINDS,
  PROVENANCE_KINDS,
  ROUTING_VERDICTS,
  SAMPLE_GROUPS,
} from "./constants.js";

export type RoutingVerdict = (typeof ROUTING_VERDICTS)[number];
export type SampleGroup = (typeof SAMPLE_GROUPS)[number];
export type DatasetSplit = (typeof DATASET_SPLITS)[number];
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];
export type HardTag = (typeof HARD_TAGS)[number];
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];
export type PredictionErrorKind = (typeof PREDICTION_ERROR_KINDS)[number];
export type HistoricalMethod = (typeof HISTORICAL_METHODS)[number];

export type GateModelInput = {
  id: string;
  title: string;
  journal: string;
  source_id: string;
};

export type DraftAnnotator = {
  kind: "ai-draft";
  model: string;
  promptVersion: string;
  policyId: string;
  policyHash: string;
};

export type HistoricalObservation = {
  reportDate: string;
  included: boolean;
  verdict: RoutingVerdict | null;
  method: HistoricalMethod | null;
  path: string;
  gitCommit: string | null;
};

export type CaseProvenance = {
  kind: ProvenanceKind;
  reportDate: string;
  path: string;
  gitCommit: string | null;
  recoverableExcluded: boolean;
  notes?: string;
};

export type LifeScienceGateCase = {
  caseId: string;
  groupId: string;
  input: GateModelInput;
  provenance: CaseProvenance;
  sampleGroup: SampleGroup;
  hardTags: HardTag[];
  split: DatasetSplit;
  annotationStatus: AnnotationStatus;
  draftVerdict: RoutingVerdict;
  draftReason: string;
  draftAnnotator: DraftAnnotator;
  goldVerdict: RoutingVerdict | null;
  goldReason: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  historical: {
    referenceOnly: true;
    observations: HistoricalObservation[];
  };
};

export type SamplingManifest = {
  seed: number;
  dateRange: { start: string; end: string };
  targetSize: number;
  devFraction: number;
  quotas: Record<string, number>;
  notes: string[];
};

export type InventoryGap = {
  id: string;
  detail: string;
};

export type LifeScienceGateDataset = {
  datasetId: "life-science-gate";
  datasetVersion: string;
  policyId: string;
  policyHash: string;
  createdAt: string;
  changelog: string[];
  sampling: SamplingManifest;
  inventoryGaps: InventoryGap[];
  cases: LifeScienceGateCase[];
};

export type PredictionRow = {
  caseId: string;
  verdict?: RoutingVerdict;
  errorKind?: PredictionErrorKind;
  latencyMs?: number | null;
  cost?: number | null;
  tokens?: number | null;
};

export type PredictionRun = {
  runId: string;
  datasetVersion: string;
  datasetHash: string;
  model: string;
  provider: string;
  promptVersion: string;
  promptHash: string;
  predictions: PredictionRow[];
};

export type DatasetIssue = {
  code: string;
  message: string;
  caseId?: string;
};

export type MetricValue = number | "N/A";
