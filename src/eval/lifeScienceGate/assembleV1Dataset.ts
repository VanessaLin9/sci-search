import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { DRAFT_ANNOTATOR_MODEL, DRAFT_LABELS_BY_PAPER_ID, DRAFT_PROMPT_VERSION } from "./draftLabels.js";
import { currentLifeScienceGatePolicy } from "./policy.js";
import { validateLifeScienceGateDataset, assertDatasetUsable } from "./validateDataset.js";
import type { LifeScienceGateCase, LifeScienceGateDataset } from "./types.js";

type CandidateFile = {
  samplingNotes: string[];
  cases: Array<Omit<LifeScienceGateCase, "annotationStatus" | "draftVerdict" | "draftReason" | "draftAnnotator" | "goldVerdict" | "goldReason" | "reviewer" | "reviewedAt">>;
};

async function main() {
  const candidatesPath = "eval/life-science-gate/v1/candidates.json";
  const outPath = "eval/life-science-gate/v1/dataset.json";
  const candidates = JSON.parse(await readFile(candidatesPath, "utf8")) as CandidateFile;
  const policy = currentLifeScienceGatePolicy();
  const missing: string[] = [];
  const cases: LifeScienceGateCase[] = candidates.cases.map((partial) => {
    const draft = DRAFT_LABELS_BY_PAPER_ID[partial.input.id];
    if (!draft) missing.push(partial.input.id);
    return {
      ...partial,
      annotationStatus: "pending_review",
      draftVerdict: draft?.verdict ?? "not_sure",
      draftReason: draft?.reason ?? "MISSING DRAFT",
      draftAnnotator: {
        kind: "ai-draft",
        model: DRAFT_ANNOTATOR_MODEL,
        promptVersion: DRAFT_PROMPT_VERSION,
        policyId: policy.policyId,
        policyHash: policy.policyHash,
      },
      goldVerdict: null,
      goldReason: null,
      reviewer: null,
      reviewedAt: null,
    };
  });
  if (missing.length > 0) {
    throw new Error(`Missing drafts for ${missing.join(", ")}`);
  }

  const dataset: LifeScienceGateDataset = {
    datasetId: "life-science-gate",
    datasetVersion: "1.0.0",
    policyId: policy.policyId,
    policyHash: policy.policyHash,
    createdAt: "2026-10-03T00:00:00.000Z",
    changelog: [
      "1.0.0: first historical sample of 100 broad-science gate cases with AI drafts; gold pending Vanessa review.",
    ],
    sampling: {
      seed: 20261003,
      dateRange: { start: "2026-05-22", end: "2026-10-02" },
      targetSize: 100,
      devFraction: 0.6,
      quotas: {
        "general.science": 12,
        "general.nature": 20,
        "general.nature-communications": 16,
        "general.science-advances": 22,
        "hard.news_commentary": 8,
        "hard.vague_title": 6,
        "hard.interdisciplinary": 8,
        "hard.keyword_fallback": 5,
        "hard.historical_disagreement": 3,
      },
      notes: candidates.samplingNotes,
    },
    inventoryGaps: [
      {
        id: "pnas-zero",
        detail: "PNAS is a broad-science source but 0 recoverable papers appeared in processed history (working tree + git).",
      },
      {
        id: "actions-artifacts-inaccessible",
        detail: "GitHub Actions run 36598521687 could not be fetched (API 403). 2026-09-30 processed papers.json in git remains the recoverable snapshot for that day.",
      },
      {
        id: "raw-rss-not-used",
        detail: "data/raw is gitignored; RSS snapshots under test/fixtures/rss-snapshots are 2026-05-22/24 only and are not treated as gate gold.",
      },
      {
        id: "probe-fixtures-not-gold",
        detail: "scripts/llm-probe/fixtures/routing-samples.json has two synthetic smoke titles (adq9999 / adp0001) and is not historical gold.",
      },
      {
        id: "hard-tag-shortfalls",
        detail: candidates.samplingNotes.join(" "),
      },
    ],
    cases,
  };

  const { issues } = validateLifeScienceGateDataset(dataset);
  assertDatasetUsable(issues);
  await writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  process.stderr.write(`wrote ${outPath} cases=${dataset.cases.length}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
