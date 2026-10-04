import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_DATASET_PATH } from "../../../src/eval/lifeScienceGate/constants.js";
import { loadDatasetFromPath } from "../../../src/eval/lifeScienceGate/loadDataset.js";
import { exportModelRequest } from "../../../src/eval/lifeScienceGate/requestExport.js";
import { officialGoldCase } from "../../../src/eval/lifeScienceGate/validateDataset.js";

describe("committed v1 dataset", () => {
  it("is valid, pending review, and does not leak gold into request export", async () => {
    const loaded = await loadDatasetFromPath(DEFAULT_DATASET_PATH);
    assert.equal(loaded.dataset.datasetVersion, "1.0.0");
    assert.equal(loaded.dataset.cases.length, 100);
    assert.equal(loaded.dataset.cases.filter((item) => item.split === "dev").length, 60);
    assert.equal(loaded.dataset.cases.filter((item) => item.split === "eval").length, 40);
    assert.equal(loaded.dataset.cases.every((item) => item.annotationStatus === "pending_review"), true);
    assert.equal(loaded.dataset.cases.every((item) => item.goldVerdict === null), true);
    assert.equal(loaded.dataset.cases.filter(officialGoldCase).length, 0);
    assert.equal(loaded.dataset.fallbackPolicy.id, "routing-keyword-fallback-v1");
    assert.equal(loaded.dataset.fallbackPolicy.hash.length, 64);

    const request = exportModelRequest(loaded.dataset, loaded.fileHash, { split: "eval" });
    assert.deepEqual(
      [...new Set(request.papers.flatMap((paper) => Object.keys(paper)))].sort(),
      ["id", "journal", "source_id", "title"],
    );
    assert.equal(JSON.stringify(request).includes("goldVerdict"), false);
    assert.equal(JSON.stringify(request).includes("draftReason"), false);
  });
});
