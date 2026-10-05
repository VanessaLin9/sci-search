import { currentLifeScienceGatePolicy } from "../../../src/eval/lifeScienceGate/policy.js";
import { snapshotFallbackPolicy } from "../../../src/eval/lifeScienceGate/fallbackPolicy.js";
import type { LifeScienceGateCase, LifeScienceGateDataset } from "../../../src/eval/lifeScienceGate/types.js";

export const TEST_KEYWORD_CONFIG = {
  includeStems: ["mice", "gene"],
  includeTerms: ["cancer"],
  sharedIncludeTerms: [],
  excludeTerms: ["quantum"],
  excludePhrases: ["black hole"],
};

const policy = currentLifeScienceGatePolicy();

const annotator = {
  kind: "ai-draft" as const,
  model: "test-annotator",
  promptVersion: "test",
  policyId: policy.policyId,
  policyHash: policy.policyHash,
};

export function testCase(
  overrides: Partial<LifeScienceGateCase> & Pick<LifeScienceGateCase, "caseId" | "input" | "goldVerdict" | "annotationStatus" | "split" | "sampleGroup">,
): LifeScienceGateCase {
  return {
    groupId: `group:${overrides.caseId}`,
    provenance: {
      kind: "historical_processed",
      reportDate: "2026-09-30",
      path: "test/fixtures/eval/tiny.json",
      gitCommit: "test",
      recoverableExcluded: true,
    },
    hardTags: overrides.sampleGroup === "hard" ? ["vague_title"] : [],
    draftVerdict: overrides.goldVerdict ?? "not_sure",
    draftReason: "test draft",
    draftAnnotator: annotator,
    goldReason: overrides.annotationStatus === "reviewed" ? "reviewed for tests" : null,
    reviewer: overrides.annotationStatus === "reviewed" ? "tester" : null,
    reviewedAt: overrides.annotationStatus === "reviewed" ? "2026-10-03T00:00:00.000Z" : null,
    historical: {
      referenceOnly: true,
      observations: [
        {
          reportDate: "2026-09-30",
          included: true,
          verdict: "yes",
          method: "llm",
          path: "test/fixtures/eval/tiny.json",
          gitCommit: "test",
        },
      ],
    },
    ...overrides,
  };
}

export function testDataset(cases: LifeScienceGateCase[]): LifeScienceGateDataset {
  return {
    datasetId: "life-science-gate",
    datasetVersion: "test-1",
    policyId: policy.policyId,
    policyHash: policy.policyHash,
    fallbackPolicy: snapshotFallbackPolicy(TEST_KEYWORD_CONFIG),
    createdAt: "2026-10-03T00:00:00.000Z",
    changelog: ["test fixture"],
    sampling: {
      seed: 1,
      dateRange: { start: "2026-09-01", end: "2026-10-02" },
      targetSize: cases.length,
      devFraction: 0.5,
      quotas: { test: cases.length },
      notes: ["tiny fixture"],
    },
    inventoryGaps: [],
    cases,
  };
}
