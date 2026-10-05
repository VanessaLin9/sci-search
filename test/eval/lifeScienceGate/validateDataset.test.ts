import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateLifeScienceGateDataset } from "../../../src/eval/lifeScienceGate/validateDataset.js";
import { testCase, testDataset } from "./helpers.js";

const scienceInput = {
  id: "10.1126/science.example",
  title: "A neural circuit for memory in mice",
  journal: "Science",
  source_id: "science",
};

describe("life-science gate dataset validation", () => {
  it("accepts a well-formed reviewed case", () => {
    const { issues } = validateLifeScienceGateDataset(
      testDataset([
        testCase({
          caseId: "c1",
          input: scienceInput,
          split: "eval",
          sampleGroup: "general",
          annotationStatus: "reviewed",
          goldVerdict: "yes",
        }),
      ]),
    );
    assert.deepEqual(issues, []);
  });

  it("rejects duplicate case ids", () => {
    const { issues } = validateLifeScienceGateDataset(
      testDataset([
        testCase({
          caseId: "c1",
          input: scienceInput,
          split: "dev",
          sampleGroup: "general",
          annotationStatus: "pending_review",
          goldVerdict: null,
        }),
        testCase({
          caseId: "c1",
          input: { ...scienceInput, id: "other" },
          split: "eval",
          sampleGroup: "general",
          annotationStatus: "pending_review",
          goldVerdict: null,
        }),
      ]),
    );
    assert.equal(issues.some((item) => item.code === "duplicate_case_id"), true);
  });

  it("rejects the same article group leaking across splits", () => {
    const { issues } = validateLifeScienceGateDataset(
      testDataset([
        testCase({
          caseId: "c1",
          groupId: "same-paper",
          input: scienceInput,
          split: "dev",
          sampleGroup: "general",
          annotationStatus: "pending_review",
          goldVerdict: null,
        }),
        testCase({
          caseId: "c2",
          groupId: "same-paper",
          input: { ...scienceInput, id: "10.1126/science.other" },
          split: "eval",
          sampleGroup: "general",
          annotationStatus: "pending_review",
          goldVerdict: null,
        }),
      ]),
    );
    assert.equal(issues.some((item) => item.code === "split_leak"), true);
  });

  it("rejects gold filled before review and life-science-only sources", () => {
    const { issues } = validateLifeScienceGateDataset(
      testDataset([
        testCase({
          caseId: "c1",
          input: scienceInput,
          split: "dev",
          sampleGroup: "general",
          annotationStatus: "pending_review",
          goldVerdict: "yes",
          goldReason: "too early",
        }),
        testCase({
          caseId: "c2",
          input: {
            id: "10.1038/s41586-example",
            title: "A Cell paper",
            journal: "Cell",
            source_id: "cell",
          },
          split: "eval",
          sampleGroup: "general",
          annotationStatus: "pending_review",
          goldVerdict: null,
        }),
      ]),
    );
    assert.equal(issues.some((item) => item.code === "unreviewed_gold"), true);
    assert.equal(issues.some((item) => item.code === "scope_default_sample"), true);
  });
});
