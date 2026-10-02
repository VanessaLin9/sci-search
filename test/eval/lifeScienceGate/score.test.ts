import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scorePredictionRun } from "../../../src/eval/lifeScienceGate/score.js";
import { contentHash } from "../../../src/eval/lifeScienceGate/hash.js";
import { testCase, testDataset } from "./helpers.js";

const keywordConfig = {
  includeStems: ["mice", "gene"],
  includeTerms: ["cancer"],
  sharedIncludeTerms: [],
  excludeTerms: ["quantum"],
  excludePhrases: ["black hole"],
};

function paper(id: string, title: string) {
  return {
    id,
    title,
    journal: "Science",
    source_id: "science" as const,
  };
}

describe("life-science gate scoring", () => {
  it("computes a hand-checkable 3-class matrix and does not treat timeout as semantic no", () => {
    const dataset = testDataset([
      testCase({
        caseId: "yes1",
        input: paper("yes1", "Gene regulation in mice"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "yes",
      }),
      testCase({
        caseId: "no1",
        input: paper("no1", "Room-temperature superconductivity"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "no",
      }),
      testCase({
        caseId: "ns1",
        input: paper("ns1", "A general framework"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "not_sure",
      }),
      testCase({
        caseId: "timeout1",
        input: paper("timeout1", "Quantum gravity"),
        split: "eval",
        sampleGroup: "hard",
        annotationStatus: "reviewed",
        goldVerdict: "no",
      }),
    ]);
    const report = scorePredictionRun({
      dataset,
      datasetHash: contentHash(dataset),
      keywordConfig,
      run: {
        runId: "r1",
        datasetVersion: dataset.datasetVersion,
        datasetHash: contentHash(dataset),
        model: "test-model",
        provider: "test",
        promptVersion: "p1",
        promptHash: "abc",
        predictions: [
          { caseId: "yes1", verdict: "yes", cost: 0.01, tokens: 10, latencyMs: 12 },
          { caseId: "no1", verdict: "yes", cost: 0.02, tokens: 11, latencyMs: 20 },
          { caseId: "ns1", verdict: "not_sure", cost: 0.03, tokens: 12, latencyMs: 30 },
          { caseId: "timeout1", errorKind: "timeout" },
        ],
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.semantic.nGold, 4);
    assert.equal(report.semantic.nSuccessful, 3);
    assert.equal(report.semantic.nErrors, 1);
    assert.equal(report.semantic.goldNoPredYes, 1);
    assert.equal(report.semantic.goldYesPredNo, 0);
    assert.equal(report.semantic.accuracy, 2 / 3);
    assert.equal(report.semantic.precision.yes, 1 / 2);
    assert.equal(report.semantic.recall.yes, 1);
    assert.equal(report.semantic.precision.no, "N/A");
    assert.equal(report.semantic.recall.no, 0);
    assert.equal(report.serviceFailures.timeout, 1);
    assert.equal(report.serviceFailures.none, 3);
    assert.equal(report.product.modelOnly.unavailable, 1);
    assert.equal(report.product.nFallbackApplied, 1);
    assert.equal(report.product.nFallbackSuccessNotModelSuccess, 1);
    assert.equal(report.product.afterFallback.goldExcludePredExclude, 1);
    assert.notEqual(report.resources.cost.total, 0);
    assert.equal(report.resources.cost.missing, 1);
  });

  it("marks zero-denominator metrics N/A for all-not_sure and all-failure runs", () => {
    const dataset = testDataset([
      testCase({
        caseId: "a",
        input: paper("a", "Something vague"),
        split: "dev",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "not_sure",
      }),
      testCase({
        caseId: "b",
        input: paper("b", "Another vague title"),
        split: "dev",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "not_sure",
      }),
    ]);
    const allNotSure = scorePredictionRun({
      dataset,
      datasetHash: contentHash(dataset),
      keywordConfig,
      run: {
        runId: "r2",
        datasetVersion: dataset.datasetVersion,
        datasetHash: contentHash(dataset),
        model: "test-model",
        provider: "test",
        promptVersion: "p1",
        promptHash: "abc",
        predictions: [
          { caseId: "a", verdict: "not_sure" },
          { caseId: "b", verdict: "not_sure" },
        ],
      },
    });
    assert.equal(allNotSure.semantic.precision.yes, "N/A");
    assert.equal(allNotSure.semantic.recall.yes, "N/A");
    assert.equal(allNotSure.semantic.precision.no, "N/A");
    assert.equal(allNotSure.semantic.notSureRate, 1);

    const allFail = scorePredictionRun({
      dataset,
      datasetHash: contentHash(dataset),
      keywordConfig,
      run: {
        runId: "r3",
        datasetVersion: dataset.datasetVersion,
        datasetHash: contentHash(dataset),
        model: "test-model",
        provider: "test",
        promptVersion: "p1",
        promptHash: "abc",
        predictions: [
          { caseId: "a", errorKind: "http_429" },
          { caseId: "b", errorKind: "http_5xx" },
        ],
      },
    });
    assert.equal(allFail.ok, true);
    assert.equal(allFail.semantic.nSuccessful, 0);
    assert.equal(allFail.semantic.accuracy, "N/A");
    assert.equal(allFail.serviceFailures.http_429, 1);
    assert.equal(allFail.serviceFailures.http_5xx, 1);
    assert.equal(allFail.resources.cost.total, "unavailable");
  });

  it("treats empty and malformed responses as service failures, not semantic no", () => {
    const dataset = testDataset([
      testCase({
        caseId: "empty1",
        input: paper("empty1", "Room-temperature superconductivity"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "no",
      }),
      testCase({
        caseId: "bad1",
        input: paper("bad1", "Gene regulation in mice"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "yes",
      }),
    ]);
    const report = scorePredictionRun({
      dataset,
      datasetHash: contentHash(dataset),
      keywordConfig,
      run: {
        runId: "r6",
        datasetVersion: dataset.datasetVersion,
        datasetHash: contentHash(dataset),
        model: "test-model",
        provider: "test",
        promptVersion: "p1",
        promptHash: "abc",
        predictions: [
          { caseId: "empty1", errorKind: "empty" },
          { caseId: "bad1", errorKind: "malformed" },
        ],
      },
    });
    assert.equal(report.semantic.nSuccessful, 0);
    assert.equal(report.semantic.goldYesPredNo, 0);
    assert.equal(report.serviceFailures.empty, 1);
    assert.equal(report.serviceFailures.malformed, 1);
    assert.equal(report.product.modelOnly.unavailable, 2);
  });

  it("does not silently pass missing, duplicate, unknown ids, or version mismatch", () => {
    const dataset = testDataset([
      testCase({
        caseId: "keep",
        input: paper("keep", "Gene editing in mice"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "yes",
      }),
    ]);
    const report = scorePredictionRun({
      dataset,
      datasetHash: "expected-hash",
      keywordConfig,
      run: {
        runId: "r4",
        datasetVersion: "other-version",
        datasetHash: "other-hash",
        model: "test-model",
        provider: "test",
        promptVersion: "p1",
        promptHash: "abc",
        predictions: [
          { caseId: "keep", verdict: "yes" },
          { caseId: "keep", verdict: "no" },
          { caseId: "unknown", verdict: "no" },
        ],
      },
    });
    assert.equal(report.ok, false);
    const codes = report.issues.map((item) => item.code);
    assert.equal(codes.includes("dataset_version_mismatch"), true);
    assert.equal(codes.includes("dataset_hash_mismatch"), true);
    assert.equal(codes.includes("duplicate_prediction_id"), true);
    assert.equal(codes.includes("unknown_prediction_id"), true);
  });

  it("excludes pending and disputed cases from official scores", () => {
    const dataset = testDataset([
      testCase({
        caseId: "pending",
        input: paper("pending", "Gene regulation in mice"),
        split: "dev",
        sampleGroup: "general",
        annotationStatus: "pending_review",
        goldVerdict: null,
      }),
      testCase({
        caseId: "reviewed",
        input: paper("reviewed", "A neural circuit in mice"),
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "yes",
      }),
    ]);
    const report = scorePredictionRun({
      dataset,
      datasetHash: contentHash(dataset),
      keywordConfig,
      run: {
        runId: "r5",
        datasetVersion: dataset.datasetVersion,
        datasetHash: contentHash(dataset),
        model: "test-model",
        provider: "test",
        promptVersion: "p1",
        promptHash: "abc",
        predictions: [
          { caseId: "pending", verdict: "no" },
          { caseId: "reviewed", verdict: "yes" },
        ],
      },
    });
    assert.equal(report.scoringScope.officialGold, 1);
    assert.equal(report.scoringScope.excludedFromOfficial[0]?.reason, "pending_review");
    assert.equal(report.semantic.nSuccessful, 1);
    assert.equal(report.semantic.accuracy, 1);
  });
});
