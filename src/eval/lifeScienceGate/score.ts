import type { RoutingKeywordsConfig } from "../../domain/life-science/routing/keywordFallbackMatcher.js";
import { ROUTING_VERDICTS } from "./constants.js";
import { modelAndFallbackOutcomes, productOutcomeFromVerdict } from "./policy.js";
import { predictionRunSchema } from "./schema.js";
import type {
  DatasetIssue,
  LifeScienceGateCase,
  LifeScienceGateDataset,
  MetricValue,
  PredictionErrorKind,
  PredictionRun,
  RoutingVerdict,
} from "./types.js";
import { officialGoldCase } from "./validateDataset.js";

export type ConfusionMatrix = {
  labels: typeof ROUTING_VERDICTS;
  /** rows = gold, cols = prediction */
  counts: number[][];
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
    officialGold: number;
    excludedFromOfficial: Array<{ caseId: string; reason: string }>;
    bySplit: Record<string, number>;
    bySampleGroup: Record<string, number>;
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
  resources: {
    cost: ResourceSummary;
    tokens: ResourceSummary;
    latencyMs: LatencySummary;
  };
};

type ProductCounts = {
  goldIncludePredInclude: number;
  goldIncludePredExclude: number;
  goldExcludePredInclude: number;
  goldExcludePredExclude: number;
  unavailable: number;
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

function emptyServiceFailures(): ScoreReport["serviceFailures"] {
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

/**
 * 離線評分：語意混淆矩陣、服務失敗、fallback 後產品結果分開報（PR #42）。
 * datasetVersion／hash／missing／duplicate／unknown IDs 不得靜默通過。
 */
export function scorePredictionRun(options: {
  dataset: LifeScienceGateDataset;
  datasetHash: string;
  run: unknown;
  keywordConfig: RoutingKeywordsConfig;
}): ScoreReport {
  const run = predictionRunSchema.parse(options.run);
  const issues: DatasetIssue[] = [];

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

  const byCaseId = new Map(options.dataset.cases.map((gateCase) => [gateCase.caseId, gateCase]));
  const seenPredIds = new Set<string>();
  const predById = new Map<string, (typeof run.predictions)[number]>();

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
    if (!byCaseId.has(prediction.caseId)) {
      issues.push({
        code: "unknown_prediction_id",
        message: `prediction caseId ${prediction.caseId} is not in the dataset`,
        caseId: prediction.caseId,
      });
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
  for (const gateCase of options.dataset.cases) {
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
  const latencies: number[] = [];
  const cost = { present: 0, missing: 0, total: 0 as number | "unavailable" };
  const tokens = { present: 0, missing: 0, total: 0 as number | "unavailable" };

  const indexOf = (verdict: RoutingVerdict) => ROUTING_VERDICTS.indexOf(verdict);

  for (const gateCase of official) {
    const gold = gateCase.goldVerdict;
    if (!gold) continue;
    const prediction = predById.get(gateCase.caseId);
    if (!prediction) {
      nMissing += 1;
      serviceFailures.missing += 1;
      issues.push({
        code: "missing_prediction_id",
        message: `official gold case ${gateCase.caseId} has no prediction`,
        caseId: gateCase.caseId,
      });
      addProduct(modelOnly, productOutcomeFromVerdict(gold), "unavailable");
      addProduct(afterFallback, productOutcomeFromVerdict(gold), "unavailable");
      continue;
    }

    const errorKind = prediction.errorKind || (prediction.verdict ? undefined : "malformed");
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
    if (prediction.latencyMs == null) {
      // counted later in latency summary
    } else {
      latencies.push(prediction.latencyMs);
    }

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

  const precision = {} as Record<RoutingVerdict, MetricValue>;
  const recall = {} as Record<RoutingVerdict, MetricValue>;
  for (const [col, label] of ROUTING_VERDICTS.entries()) {
    const predicted = confusion.counts.reduce((sum, row) => sum + row[col], 0);
    const goldCount = confusion.counts[col].reduce((sum, value) => sum + value, 0);
    const truePositive = confusion.counts[col][col];
    precision[label] = ratio(truePositive, predicted);
    recall[label] = ratio(truePositive, goldCount);
  }

  if (cost.present === 0) cost.total = "unavailable";
  if (tokens.present === 0) tokens.total = "unavailable";
  const latencyMissing = official.length - latencies.length;
  latencies.sort((a, b) => a - b);

  const bySplit: Record<string, number> = { dev: 0, eval: 0 };
  const bySampleGroup: Record<string, number> = { general: 0, hard: 0 };
  for (const gateCase of official) {
    bySplit[gateCase.split] += 1;
    bySampleGroup[gateCase.sampleGroup] += 1;
  }

  const blocking = issues.some((item) =>
    [
      "dataset_version_mismatch",
      "dataset_hash_mismatch",
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
      officialGold: official.length,
      excludedFromOfficial,
      bySplit,
      bySampleGroup,
    },
    semantic: {
      nGold: official.length,
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
    },
    serviceFailures,
    product: {
      nFallbackApplied,
      nFallbackSuccessNotModelSuccess,
      modelOnly,
      afterFallback,
    },
    resources: {
      cost: { present: cost.present, missing: cost.missing, total: cost.total },
      tokens: { present: tokens.present, missing: tokens.missing, total: tokens.total },
      latencyMs: {
        present: latencies.length,
        missing: latencyMissing,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
      },
    },
  };
}
