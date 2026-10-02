import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyReviewRows,
  exportReviewCsv,
  parseReviewCsv,
} from "../../../src/eval/lifeScienceGate/reviewTable.js";
import { exportModelRequest, assertRequestHasNoGold } from "../../../src/eval/lifeScienceGate/requestExport.js";
import { contentHash } from "../../../src/eval/lifeScienceGate/hash.js";
import { testCase, testDataset } from "./helpers.js";

describe("review table and request export", () => {
  it("round-trips ids, Chinese, punctuation, and annotation status", () => {
    const dataset = testDataset([
      testCase({
        caseId: "ls-001",
        input: {
          id: "10.1126/science.adq1234",
          title: "小鼠記憶連結：「壓力」下的神經迴路（初稿）",
          journal: "Science",
          source_id: "science",
        },
        split: "dev",
        sampleGroup: "general",
        annotationStatus: "pending_review",
        goldVerdict: null,
        draftReason: "標題含小鼠與記憶，足以判斷為生命科學。",
      }),
    ]);
    const csv = exportReviewCsv(dataset);
    const parsed = parseReviewCsv(csv);
    assert.equal(parsed[0]?.caseId, "ls-001");
    assert.equal(parsed[0]?.title, "小鼠記憶連結：「壓力」下的神經迴路（初稿）");
    assert.equal(parsed[0]?.draftReason, "標題含小鼠與記憶，足以判斷為生命科學。");
    assert.equal(parsed[0]?.annotationStatus, "pending_review");

    parsed[0].goldVerdict = "yes";
    parsed[0].goldReason = "同意初標。";
    parsed[0].annotationStatus = "reviewed";
    parsed[0].reviewer = "Vanessa";
    parsed[0].reviewedAt = "2026-10-03T00:00:00.000Z";
    const updated = applyReviewRows(dataset, parsed);
    assert.equal(updated.cases[0]?.goldVerdict, "yes");
    assert.equal(updated.cases[0]?.goldReason, "同意初標。");
    assert.equal(updated.cases[0]?.annotationStatus, "reviewed");
  });

  it("keeps gold and historical verdicts out of model request export", () => {
    const dataset = testDataset([
      testCase({
        caseId: "ls-002",
        input: {
          id: "10.1126/science.adq9999",
          title: "A neural circuit for stress-induced memory linking in mice",
          journal: "Science",
          source_id: "science",
        },
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "reviewed",
        goldVerdict: "yes",
      }),
    ]);
    const payload = exportModelRequest(dataset, contentHash(dataset), { split: "eval" });
    assert.equal(payload.papers.length, 1);
    assert.deepEqual(Object.keys(payload.papers[0] ?? {}).sort(), ["id", "journal", "source_id", "title"]);
    assertRequestHasNoGold(payload);
    assert.equal("goldVerdict" in payload, false);
  });
});
