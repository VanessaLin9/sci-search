import type { RoutingKeywordsConfig } from "../../domain/life-science/routing/keywordFallbackMatcher.js";
import { DATASET_SPLITS, ROUTING_VERDICTS, SAMPLE_GROUPS } from "./constants.js";
import { fallbackPolicyHash } from "./fallbackPolicy.js";
import { modelAndFallbackOutcomes, productOutcomeFromVerdict } from "./policy.js";
import { predictionRunSchema } from "./schema.js";
import type {
  DatasetIssue,
  DatasetSplit,
  LifeScienceGateCase,
  LifeScienceGateDataset,
  MetricValue,
  PredictionErrorKind,
  PredictionRow,
  RoutingVerdict,
  SampleGroup,
} from "./types.js";
import { officialGoldCase } from "./validateDataset.js";

export type ConfusionMatrix = {
  labels: typeof ROUTING_VERDICTS;
  /** rows = gold, cols = prediction */
  counts: number[][];
};

export type ProductCounts = {
  goldIncludePredInclude: number;
  goldIncludePredExclude: number;
  goldExcludePredInclude: number;
  goldExcludePredExclude: number;
  unavailable: number;
};

export type QualitySlice = {
  nGold: number;
  nSuccessful: number;
  nErrors: number;
  nMissing: number;
  notSureRate: MetricValue;
  accuracy: MetricValue;
  confusion: ConfusionMatrix;
  precision: Record<RoutingVerdict, MetricValue>;
  recall: Record<RoutingVerdict, MetricValue>;
  goldYesPredNo: number;
  goldNoPredYes: number;
  abstainWhenGoldDecisive: number;
  nFallbackApplied: number;
  nFallbackSuccessNotModelSuccess: number;
  modelOnly: ProductCounts;
  afterFallback: ProductCounts;
  serviceFailures: Record<PredictionErrorKind | "none", number>;
};

export type ScoreReport = {
  ok: boolean;
  command: "score";
  datasetVersion: string;
  datasetHash: string;
  runId: string;
  model: string;
  provider: string;
  promptVersion: string;
  promptHash: string;
  issues: DatasetIssue[];
  scoringScope: {
    split: DatasetSplit | "all";
    officialGold: number;
    excludedFromOfficial: Array<{ caseId: string; reason: string }>;
    outOfScope: number;
    bySplit: Record<string, number>;
    bySampleGroup: Record<string, number>;
  };
  fallbackPolicy: {
    id: string;
    hash: string;
  };
  semantic: {
    nGold: number;
    nSuccessful: number;
    nErrors: number;
    nMissing: number;
    notSureRate: MetricValue;
    accuracy: MetricValue;
    confusion: ConfusionMatrix;
    precision: Record<RoutingVerdict, MetricValue>;
    recall: Record<RoutingVerdict, MetricValue>;
    goldYesPredNo: number;
    goldNoPredYes: number;
    abstainWhenGoldDecisive: number;
  };
  serviceFailures: Record<PredictionErrorKind | "none", number>;
  product: {
    nFallbackApplied: number;
    nFallbackSuccessNotModelSuccess: number;
    modelOnly: ProductCounts;
    afterFallback: ProductCounts;
  };
  slices: {
    bySplit: Record<DatasetSplit, QualitySlice>;
    bySampleGroup: Record<SampleGroup, QualitySlice>;
  };
  resources: {
    cost: ResourceSummary;
    tokens: ResourceSummary;
    latencyMs: LatencySummary;
  };
};

type ResourceSummary = {
  present: number;
  missing: number;
  total: number | "unavailable";
};

type LatencySummary = {
  present: number;
  missing: number;
  p50: MetricValue;
  p95: MetricValue;
};

function ratio(numerator: number, denominator: number): MetricValue {
  if (denominator === 0) return "N/A";
  return numerator / denominator;
}

function emptyConfusion(): ConfusionMatrix {
  return {
    labels: ROUTING_VERDICTS,
    counts: ROUTING_VERDICTS.map(() => ROUTING_VERDICTS.map(() => 0)),
  };
}

function emptyProduct(): ProductCounts {
  return {
    goldIncludePredInclude: 0,
    goldIncludePredExclude: 0,
    goldExcludePredInclude: 0,
    goldExcludePredExclude: 0,
    unavailable: 0,
  };
}

function emptyServiceFailures(): QualitySlice["serviceFailures"] {
  return {
    timeout: 0,
    http_429: 0,
    http_5xx: 0,
    empty: 0,
    malformed: 0,
    missing: 0,
    other: 0,
    none: 0,
  };
}

function percentile(sorted: number[], p: number): MetricValue {
  if (sorted.length === 0) return "N/A";
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? "N/A";
}

function addProduct(counts: ProductCounts, gold: "include" | "exclude", pred: "include" | "exclude" | "unavailable") {
  if (pred === "unavailable") {
    counts.unavailable += 1;
    return;
  }
  if (gold === "include" && pred === "include") counts.goldIncludePredInclude += 1;
  if (gold === "include" && pred === "exclude") counts.goldIncludePredExclude += 1;
  if (gold === "exclude" && pred === "include") counts.goldExcludePredInclude += 1;
  if (gold === "exclude" && pred === "exclude") counts.goldExcludePredExclude += 1;
}

function inScoreScope(gateCase: LifeScienceGateCase, split: DatasetSplit | "all"): boolean {
  return split === "all" || gateCase.split === split;
}

function precisionRecall(confusion: ConfusionMatrix): {
  precision: Record<RoutingVerdict, MetricValue>;
  recall: Record<RoutingVerdict, MetricValue>;
} {
  const precision = {} as Record<RoutingVerdict, MetricValue>;
  const recall = {} as Record<RoutingVerdict, MetricValue>;
  for (const [col, label] of ROUTING_VERDICTS.entries()) {
    const predicted = confusion.counts.reduce((sum, row) => sum + row[col], 0);
    const goldCount = confusion.counts[col].reduce((sum, value) => sum + value, 0);
    const truePositive = confusion.counts[col][col];
    precision[label] = ratio(truePositive, predicted);
    recall[label] = ratio(truePositive, goldCount);
  }
  return { precision, recall };
}

function scoreOfficialSlice(options: {
  official: LifeScienceGateCase[];
  predById: Map<string, PredictionRow>;
  keywordConfig: RoutingKeywordsConfig;
  issues?: DatasetIssue[];
}): QualitySlice {
  const confusion = emptyConfusion();
  const serviceFailures = emptyServiceFailures();
  const modelOnly = emptyProduct();
  const afterFallback = emptyProduct();
  let nSuccessful = 0;
  let nErrors = 0;
  let nMissing = 0;
  let goldYesPredNo = 0;
  let goldNoPredYes = 0;
  let abstainWhenGoldDecisive = 0;
  let nFallbackApplied = 0;
  let nFallbackSuccessNotModelSuccess = 0;
  let notSureSuccessful = 0;
  let correct = 0;
  const indexOf = (verdict: RoutingVerdict) => ROUTING_VERDICTS.indexOf(verdict);

  for (const gateCase of options.official) {
    const gold = gateCase.goldVerdict;
    if (!gold) continue;
    const prediction = options.predById.get(gateCase.caseId);
    if (!prediction) {
      nMissing += 1;
      serviceFailures.missing += 1;
      options.issues?.push({
        code: "missing_prediction_id",
        message: `official gold case ${gateCase.caseId} has no prediction`,
        caseId: gateCase.caseId,
      });
      addProduct(modelOnly, productOutcomeFromVerdict(gold), "unavailable");
      addProduct(afterFallback, productOutcomeFromVerdict(gold), "unavailable");
      continue;
    }

    const errorKind = prediction.errorKind || (prediction.verdict ? undefined : "malformed");
    const outcomes = modelAndFallbackOutcomes({
      verdict: prediction.verdict,
      errorKind,
      title: gateCase.input.title,
      keywordConfig: options.keywordConfig,
    });
    addProduct(modelOnly, productOutcomeFromVerdict(gold), outcomes.modelOutcome);
    addProduct(afterFallback, productOutcomeFromVerdict(gold), outcomes.fallbackOutcome);
    if (outcomes.fallbackApplied) {
      nFallbackApplied += 1;
      if (outcomes.fallbackOutcome !== "unavailable") {
        nFallbackSuccessNotModelSuccess += 1;
      }
    }

    if (errorKind || !prediction.verdict) {
      nErrors += 1;
      serviceFailures[errorKind ?? "other"] += 1;
      continue;
    }

    nSuccessful += 1;
    serviceFailures.none += 1;
    if (prediction.verdict === "not_sure") notSureSuccessful += 1;
    if (prediction.verdict === gold) correct += 1;
    confusion.counts[indexOf(gold)][indexOf(prediction.verdict)] += 1;
    if (gold === "yes" && prediction.verdict === "no") goldYesPredNo += 1;
    if (gold === "no" && prediction.verdict === "yes") goldNoPredYes += 1;
    if (gold !== "not_sure" && prediction.verdict === "not_sure") abstainWhenGoldDecisive += 1;
  }

  const { precision, recall } = precisionRecall(confusion);
  return {
    nGold: options.official.length,
    nSuccessful,
    nErrors,
    nMissing,
    notSureRate: ratio(notSureSuccessful, nSuccessful),
    accuracy: ratio(correct, nSuccessful),
    confusion,
    precision,
    recall,
    goldYesPredNo,
    goldNoPredYes,
    abstainWhenGoldDecisive,
    nFallbackApplied,
    nFallbackSuccessNotModelSuccess,
    modelOnly,
    afterFallback,
    serviceFailures,
  };
}

function resourceTotals(official: LifeScienceGateCase[], predById: Map<string, PredictionRow>) {
  const latencies: number[] = [];
  const cost = { present: 0, missing: 0, total: 0 as number | "unavailable" };
  const tokens = { present: 0, missing: 0, total: 0 as number | "unavailable" };

  for (const gateCase of official) {
    const prediction = predById.get(gateCase.caseId);
    if (!prediction) {
      cost.missing += 1;
      tokens.missing += 1;
      continue;
    }
    if (prediction.cost == null) {
      cost.missing += 1;
    } else {
      cost.present += 1;
      if (cost.total !== "unavailable") cost.total += prediction.cost;
    }
    if (prediction.tokens == null) {
      tokens.missing += 1;
    } else {
      tokens.present += 1;
      if (tokens.total !== "unavailable") tokens.total += prediction.tokens;
    }
    if (prediction.latencyMs != null) {
      latencies.push(prediction.latencyMs);
    }
  }

  // 缺任何一筆就把加總標成 unavailable，避免部分加總被當成完整 run 成本（PR #42）。
  if (cost.present === 0 || cost.missing > 0) cost.total = "unavailable";
  if (tokens.present === 0 || tokens.missing > 0) tokens.total = "unavailable";
  latencies.sort((a, b) => a - b);
  return {
    cost: { present: cost.present, missing: cost.missing, total: cost.total },
    tokens: { present: tokens.present, missing: tokens.missing, total: tokens.total },
    latencyMs: {
      present: latencies.length,
      missing: official.length - latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
  };
}

/**
 * 離線評分：語意混淆矩陣、服務失敗、fallback 後產品結果分開報（PR #42）。
 * datasetVersion／hash／missing／duplicate／unknown IDs 不得靜默通過。
 * split scope 必須對應 export-request；afterFallback 用 dataset 內的 keyword 快照，不用 live config。
 */
export function scorePredictionRun(options: {
  dataset: LifeScienceGateDataset;
  datasetHash: string;
  run: unknown;
  keywordConfig?: RoutingKeywordsConfig;
  split?: DatasetSplit;
}): ScoreReport {
  const run = predictionRunSchema.parse(options.run);
  const issues: DatasetIssue[] = [];
  const split: DatasetSplit | "all" = options.split ?? run.split ?? "all";
  // split scope 對齊 export-request；範圍外的官方 gold 不列 missing（PR #42）。
  const snapshotKeywords = options.dataset.fallbackPolicy.keywords;

  if (run.datasetVersion !== options.dataset.datasetVersion) {
    issues.push({
      code: "dataset_version_mismatch",
      message: `predictions datasetVersion ${run.datasetVersion} != ${options.dataset.datasetVersion}`,
    });
  }
  if (run.datasetHash !== options.datasetHash) {
    issues.push({
      code: "dataset_hash_mismatch",
      message: `predictions datasetHash ${run.datasetHash} != ${options.datasetHash}`,
    });
  }
  if (options.keywordConfig) {
    const liveHash = fallbackPolicyHash(options.keywordConfig);
    if (liveHash !== options.dataset.fallbackPolicy.hash) {
      issues.push({
        code: "fallback_policy_hash_mismatch",
        message: `live keyword config hash ${liveHash} != dataset fallbackPolicy.hash ${options.dataset.fallbackPolicy.hash}`,
      });
    }
  }

  const byCaseId = new Map(options.dataset.cases.map((gateCase) => [gateCase.caseId, gateCase]));
  const seenPredIds = new Set<string>();
  const predById = new Map<string, PredictionRow>();

  for (const prediction of run.predictions) {
    if (seenPredIds.has(prediction.caseId)) {
      issues.push({
        code: "duplicate_prediction_id",
        message: `duplicate prediction for ${prediction.caseId}`,
        caseId: prediction.caseId,
      });
      continue;
    }
    seenPredIds.add(prediction.caseId);
    const gateCase = byCaseId.get(prediction.caseId);
    if (!gateCase) {
      issues.push({
        code: "unknown_prediction_id",
        message: `prediction caseId ${prediction.caseId} is not in the dataset`,
        caseId: prediction.caseId,
      });
      continue;
    }
    if (!inScoreScope(gateCase, split)) {
      continue;
    }
    if (prediction.errorKind && prediction.verdict) {
      issues.push({
        code: "malformed_prediction",
        message: "prediction cannot include both verdict and errorKind",
        caseId: prediction.caseId,
      });
    }
    if (!prediction.errorKind && !prediction.verdict) {
      issues.push({
        code: "malformed_prediction",
        message: "prediction needs verdict or errorKind",
        caseId: prediction.caseId,
      });
    }
    predById.set(prediction.caseId, prediction);
  }

  const excludedFromOfficial: Array<{ caseId: string; reason: string }> = [];
  const official: LifeScienceGateCase[] = [];
  let outOfScope = 0;
  for (const gateCase of options.dataset.cases) {
    if (!inScoreScope(gateCase, split)) {
      outOfScope += 1;
      continue;
    }
    if (officialGoldCase(gateCase)) {
      official.push(gateCase);
      continue;
    }
    const reason =
      gateCase.annotationStatus === "disputed"
        ? "disputed"
        : gateCase.annotationStatus === "pending_review"
          ? "pending_review"
          : "gold_not_final";
    excludedFromOfficial.push({ caseId: gateCase.caseId, reason });
  }

  const overall = scoreOfficialSlice({
    official,
    predById,
    keywordConfig: snapshotKeywords,
    issues,
  });

  const bySplitCounts: Record<string, number> = { dev: 0, eval: 0 };
  const bySampleGroupCounts: Record<string, number> = { general: 0, hard: 0 };
  for (const gateCase of official) {
    bySplitCounts[gateCase.split] += 1;
    bySampleGroupCounts[gateCase.sampleGroup] += 1;
  }

  const bySplit = {} as Record<DatasetSplit, QualitySlice>;
  for (const splitName of DATASET_SPLITS) {
    bySplit[splitName] = scoreOfficialSlice({
      official: official.filter((gateCase) => gateCase.split === splitName),
      predById,
      keywordConfig: snapshotKeywords,
    });
  }
  const bySampleGroup = {} as Record<SampleGroup, QualitySlice>;
  for (const group of SAMPLE_GROUPS) {
    bySampleGroup[group] = scoreOfficialSlice({
      official: official.filter((gateCase) => gateCase.sampleGroup === group),
      predById,
      keywordConfig: snapshotKeywords,
    });
  }

  const blocking = issues.some((item) =>
    [
      "dataset_version_mismatch",
      "dataset_hash_mismatch",
      "fallback_policy_hash_mismatch",
      "duplicate_prediction_id",
      "unknown_prediction_id",
      "missing_prediction_id",
      "malformed_prediction",
    ].includes(item.code),
  );

  return {
    ok: !blocking,
    command: "score",
    datasetVersion: options.dataset.datasetVersion,
    datasetHash: options.datasetHash,
    runId: run.runId,
    model: run.model,
    provider: run.provider,
    promptVersion: run.promptVersion,
    promptHash: run.promptHash,
    issues,
    scoringScope: {
      split,
      officialGold: official.length,
      excludedFromOfficial,
      outOfScope,
      bySplit: bySplitCounts,
      bySampleGroup: bySampleGroupCounts,
    },
    fallbackPolicy: {
      id: options.dataset.fallbackPolicy.id,
      hash: options.dataset.fallbackPolicy.hash,
    },
    semantic: {
      nGold: overall.nGold,
      nSuccessful: overall.nSuccessful,
      nErrors: overall.nErrors,
      nMissing: overall.nMissing,
      notSureRate: overall.notSureRate,
      accuracy: overall.accuracy,
      confusion: overall.confusion,
      precision: overall.precision,
      recall: overall.recall,
      goldYesPredNo: overall.goldYesPredNo,
      goldNoPredYes: overall.goldNoPredYes,
      abstainWhenGoldDecisive: overall.abstainWhenGoldDecisive,
    },
    serviceFailures: overall.serviceFailures,
    product: {
      nFallbackApplied: overall.nFallbackApplied,
      nFallbackSuccessNotModelSuccess: overall.nFallbackSuccessNotModelSuccess,
      modelOnly: overall.modelOnly,
      afterFallback: overall.afterFallback,
    },
    slices: { bySplit, bySampleGroup },
    resources: resourceTotals(official, predById),
  };
}
