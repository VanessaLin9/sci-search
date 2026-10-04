import { readFile, writeFile } from "node:fs/promises";
import { loadRoutingKeywordsConfig } from "../../config.js";
import { DEFAULT_DATASET_PATH } from "./constants.js";
import { exportReviewCsv, parseReviewCsv, applyReviewRows } from "./reviewTable.js";
import { loadDatasetFromPath } from "./loadDataset.js";
import { exportModelRequest } from "./requestExport.js";
import { scorePredictionRun } from "./score.js";
import { currentLifeScienceGatePolicy } from "./policy.js";
import { validateLifeScienceGateDataset } from "./validateDataset.js";

export type EvalCliIo = {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
};

export type ParsedEvalCli =
  | { command: "validate"; datasetPath: string }
  | { command: "export-review"; datasetPath: string; outPath?: string }
  | { command: "apply-review"; datasetPath: string; reviewPath: string; outPath?: string }
  | { command: "export-request"; datasetPath: string; outPath?: string; split?: "dev" | "eval" }
  | { command: "score"; datasetPath: string; predictionsPath: string; outPath?: string; split?: "dev" | "eval" };

function readFlag(argv: string[], name: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === `--${name}` && argv[index + 1]) return argv[index + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(`--${name}=`.length);
  }
  return undefined;
}

export function parseEvalCli(argv: string[]): ParsedEvalCli {
  const command = argv[0];
  const datasetPath = readFlag(argv, "dataset") ?? DEFAULT_DATASET_PATH;
  if (command === "validate") return { command, datasetPath };
  if (command === "export-review") {
    return { command, datasetPath, outPath: readFlag(argv, "out") };
  }
  if (command === "apply-review") {
    const reviewPath = readFlag(argv, "review");
    if (!reviewPath) throw new Error("apply-review requires --review <csv>");
    return { command, datasetPath, reviewPath, outPath: readFlag(argv, "out") };
  }
  if (command === "export-request") {
    const splitFlag = readFlag(argv, "split");
    let split: "dev" | "eval" | undefined;
    if (splitFlag === "dev" || splitFlag === "eval") {
      split = splitFlag;
    } else if (splitFlag) {
      throw new Error("--split must be dev or eval");
    }
    return { command, datasetPath, outPath: readFlag(argv, "out"), split };
  }
  if (command === "score") {
    const predictionsPath = readFlag(argv, "predictions");
    if (!predictionsPath) throw new Error("score requires --predictions <json>");
    const splitFlag = readFlag(argv, "split");
    let split: "dev" | "eval" | undefined;
    if (splitFlag === "dev" || splitFlag === "eval") {
      split = splitFlag;
    } else if (splitFlag) {
      throw new Error("--split must be dev or eval");
    }
    return { command, datasetPath, predictionsPath, outPath: readFlag(argv, "out"), split };
  }
  throw new Error("Usage: validate | export-review | apply-review | export-request | score");
}

/** stdout 只放 JSON；進度與診斷走 stderr，避免污染可機器讀取輸出（PR #42）。 */
function emitJson(io: EvalCliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runEvalCli(
  argv: string[],
  io: EvalCliIo = {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
  },
): Promise<number> {
  const parsed = parseEvalCli(argv);
  const loaded = await loadDatasetFromPath(parsed.datasetPath);
  io.stderr(`[eval:life-science-gate] ${parsed.command} dataset=${loaded.path}\n`);

  if (parsed.command === "validate") {
    const policy = currentLifeScienceGatePolicy();
    emitJson(io, {
      ok: true,
      command: "validate",
      datasetVersion: loaded.dataset.datasetVersion,
      datasetHash: loaded.fileHash,
      contentHash: loaded.contentHash,
      policyId: policy.policyId,
      policyHash: policy.policyHash,
      counts: {
        cases: loaded.dataset.cases.length,
        pendingReview: loaded.dataset.cases.filter((item) => item.annotationStatus === "pending_review").length,
        reviewed: loaded.dataset.cases.filter((item) => item.annotationStatus === "reviewed").length,
        disputed: loaded.dataset.cases.filter((item) => item.annotationStatus === "disputed").length,
        general: loaded.dataset.cases.filter((item) => item.sampleGroup === "general").length,
        hard: loaded.dataset.cases.filter((item) => item.sampleGroup === "hard").length,
        dev: loaded.dataset.cases.filter((item) => item.split === "dev").length,
        eval: loaded.dataset.cases.filter((item) => item.split === "eval").length,
      },
    });
    return 0;
  }

  if (parsed.command === "export-review") {
    const csv = exportReviewCsv(loaded.dataset);
    if (parsed.outPath) {
      await writeFile(parsed.outPath, csv, "utf8");
      io.stderr(`[eval:life-science-gate] wrote ${parsed.outPath}\n`);
    }
    emitJson(io, {
      ok: true,
      command: "export-review",
      datasetHash: loaded.fileHash,
      rowCount: loaded.dataset.cases.length,
      outPath: parsed.outPath ?? null,
      csv: parsed.outPath ? undefined : csv,
    });
    return 0;
  }

  if (parsed.command === "apply-review") {
    const updated = applyReviewRows(loaded.dataset, parseReviewCsv(await readFile(parsed.reviewPath, "utf8")));
    const { issues } = validateLifeScienceGateDataset(updated);
    // 寫入前先驗證；失敗非零退出並保留原檔，避免 README 的 --out 覆寫掉有效 dataset（PR #42）。
    if (issues.length > 0) {
      emitJson(io, {
        ok: false,
        command: "apply-review",
        datasetVersion: loaded.dataset.datasetVersion,
        issues,
        outPath: parsed.outPath ?? null,
      });
      return 1;
    }
    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    if (parsed.outPath) {
      await writeFile(parsed.outPath, serialized, "utf8");
      io.stderr(`[eval:life-science-gate] wrote ${parsed.outPath}\n`);
    }
    emitJson(io, {
      ok: true,
      command: "apply-review",
      datasetVersion: updated.datasetVersion,
      caseCount: updated.cases.length,
      reviewed: updated.cases.filter((item) => item.annotationStatus === "reviewed").length,
      outPath: parsed.outPath ?? null,
      dataset: parsed.outPath ? undefined : updated,
    });
    return 0;
  }

  if (parsed.command === "export-request") {
    const payload = exportModelRequest(loaded.dataset, loaded.fileHash, { split: parsed.split });
    if (parsed.outPath) {
      await writeFile(parsed.outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      io.stderr(`[eval:life-science-gate] wrote ${parsed.outPath}\n`);
    }
    emitJson(io, payload);
    return 0;
  }

  const rawPredictions = JSON.parse(await readFile(parsed.predictionsPath, "utf8")) as unknown;
  const report = scorePredictionRun({
    dataset: loaded.dataset,
    datasetHash: loaded.fileHash,
    run: rawPredictions,
    keywordConfig: loadRoutingKeywordsConfig(),
    split: parsed.split,
  });
  if (parsed.outPath) {
    await writeFile(parsed.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    io.stderr(`[eval:life-science-gate] wrote ${parsed.outPath}\n`);
  }
  emitJson(io, report);
  return report.ok ? 0 : 1;
}
