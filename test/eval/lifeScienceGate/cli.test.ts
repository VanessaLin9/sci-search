import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEvalCli, runEvalCli } from "../../../src/eval/lifeScienceGate/cli.js";
import { contentHash, sha256Hex } from "../../../src/eval/lifeScienceGate/hash.js";
import { snapshotFallbackPolicy } from "../../../src/eval/lifeScienceGate/fallbackPolicy.js";
import { loadRoutingKeywordsConfig } from "../../../src/config.js";
import { encodeCsv, exportReviewCsv, parseReviewCsv } from "../../../src/eval/lifeScienceGate/reviewTable.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCase, testDataset } from "./helpers.js";

describe("eval CLI", () => {
  it("parses commands and keeps diagnostics off stdout", async () => {
    const parsed = parseEvalCli(["score", "--predictions", "p.json", "--dataset", "d.json"]);
    assert.equal(parsed.command, "score");
    if (parsed.command !== "score") throw new Error("expected score");
    assert.equal(parsed.predictionsPath, "p.json");

    const dataset = {
      ...testDataset([
        testCase({
          caseId: "c1",
          input: {
            id: "c1",
            title: "Gene regulation in mice",
            journal: "Science",
            source_id: "science",
          },
          split: "eval",
          sampleGroup: "general",
          annotationStatus: "reviewed",
          goldVerdict: "yes",
        }),
      ]),
      fallbackPolicy: snapshotFallbackPolicy(loadRoutingKeywordsConfig()),
    };
    const dir = await mkdtemp(join(tmpdir(), "ls-gate-eval-"));
    const datasetPath = join(dir, "dataset.json");
    const predictionsPath = join(dir, "preds.json");
    const rawDataset = `${JSON.stringify(dataset, null, 2)}\n`;
    await writeFile(datasetPath, rawDataset);
    await writeFile(
      predictionsPath,
      JSON.stringify({
        runId: "cli-run",
        datasetVersion: dataset.datasetVersion,
        datasetHash: sha256Hex(rawDataset),
        model: "test",
        provider: "test",
        promptVersion: "p",
        promptHash: "h",
        predictions: [{ caseId: "c1", verdict: "yes" }],
      }),
    );

    let stdout = "";
    let stderr = "";
    const code = await runEvalCli(["score", "--dataset", datasetPath, "--predictions", predictionsPath], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });
    assert.equal(code, 0);
    const payload = JSON.parse(stdout) as { ok: boolean; command: string };
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "score");
    assert.match(stderr, /eval:life-science-gate/);
    assert.equal(stdout.includes("eval:life-science-gate"), false);
    assert.equal(contentHash(dataset).length, 64);
  });

  it("rejects incomplete or unreviewed gold before writing and leaves the original file", async () => {
    const dataset = testDataset([
      testCase({
        caseId: "c1",
        input: {
          id: "c1",
          title: "Gene regulation in mice",
          journal: "Science",
          source_id: "science",
        },
        split: "eval",
        sampleGroup: "general",
        annotationStatus: "pending_review",
        goldVerdict: null,
      }),
    ]);
    const dir = await mkdtemp(join(tmpdir(), "ls-gate-apply-"));
    const datasetPath = join(dir, "dataset.json");
    const original = `${JSON.stringify(dataset, null, 2)}\n`;
    await writeFile(datasetPath, original);

    const csv = exportReviewCsv(dataset);
    const header = csv.split("\n")[0]?.split(",") ?? [];
    const writeReview = async (path: string, mutate: (row: ReturnType<typeof parseReviewCsv>[number]) => void) => {
      const rows = parseReviewCsv(csv);
      mutate(rows[0]!);
      await writeFile(
        path,
        encodeCsv([header, header.map((column) => rows[0]![column as keyof (typeof rows)[number]])]),
      );
    };

    const incompletePath = join(dir, "incomplete.csv");
    await writeReview(incompletePath, (row) => {
      row.annotationStatus = "reviewed";
    });

    let stdout = "";
    const incompleteCode = await runEvalCli(
      ["apply-review", "--dataset", datasetPath, "--review", incompletePath, "--out", datasetPath],
      {
        stdout: (chunk) => {
          stdout += chunk;
        },
        stderr: () => {},
      },
    );
    const incompletePayload = JSON.parse(stdout) as { ok: boolean; issues: Array<{ code: string }> };
    assert.equal(incompleteCode, 1);
    assert.equal(incompletePayload.ok, false);
    assert.equal(
      incompletePayload.issues.some((item) => item.code === "reviewed_without_gold"),
      true,
    );
    assert.equal(await readFile(datasetPath, "utf8"), original);

    const unreviewedPath = join(dir, "unreviewed.csv");
    await writeReview(unreviewedPath, (row) => {
      row.goldVerdict = "yes";
      row.goldReason = "too early";
      row.annotationStatus = "pending_review";
    });

    stdout = "";
    const unreviewedCode = await runEvalCli(
      ["apply-review", "--dataset", datasetPath, "--review", unreviewedPath, "--out", datasetPath],
      {
        stdout: (chunk) => {
          stdout += chunk;
        },
        stderr: () => {},
      },
    );
    const unreviewedPayload = JSON.parse(stdout) as { ok: boolean; issues: Array<{ code: string }> };
    assert.equal(unreviewedCode, 1);
    assert.equal(unreviewedPayload.ok, false);
    assert.equal(
      unreviewedPayload.issues.some((item) => item.code === "unreviewed_gold"),
      true,
    );
    assert.equal(await readFile(datasetPath, "utf8"), original);
  });
});
