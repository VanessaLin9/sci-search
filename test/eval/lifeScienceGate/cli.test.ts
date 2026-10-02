import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEvalCli, runEvalCli } from "../../../src/eval/lifeScienceGate/cli.js";
import { contentHash, sha256Hex } from "../../../src/eval/lifeScienceGate/hash.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCase, testDataset } from "./helpers.js";

describe("eval CLI", () => {
  it("parses commands and keeps diagnostics off stdout", async () => {
    const parsed = parseEvalCli(["score", "--predictions", "p.json", "--dataset", "d.json"]);
    assert.equal(parsed.command, "score");
    if (parsed.command !== "score") throw new Error("expected score");
    assert.equal(parsed.predictionsPath, "p.json");

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
        annotationStatus: "reviewed",
        goldVerdict: "yes",
      }),
    ]);
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
});
