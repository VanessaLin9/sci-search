import type { GateModelInput, LifeScienceGateDataset } from "./types.js";

export type ModelRequestExport = {
  datasetVersion: string;
  datasetHash: string;
  policyId: string;
  policyHash: string;
  split?: string;
  papers: GateModelInput[];
};

const FORBIDDEN_REQUEST_KEYS = [
  "goldVerdict",
  "goldReason",
  "draftVerdict",
  "draftReason",
  "historical",
  "annotationStatus",
  "reviewer",
  "abstract",
];

/** 模型請求只含正式 gate 可見欄位；gold／draft／historical 洩漏直接失敗（PR #42）。 */
export function exportModelRequest(
  dataset: LifeScienceGateDataset,
  datasetHash: string,
  options?: { split?: "dev" | "eval" },
): ModelRequestExport {
  const papers = dataset.cases
    .filter((gateCase) => (options?.split ? gateCase.split === options.split : true))
    .map((gateCase) => ({ ...gateCase.input }));

  const payload: ModelRequestExport = {
    datasetVersion: dataset.datasetVersion,
    datasetHash,
    policyId: dataset.policyId,
    policyHash: dataset.policyHash,
    papers,
  };
  if (options?.split) payload.split = options.split;

  const serialized = JSON.stringify(payload);
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Request export leaked forbidden key ${key}`);
    }
  }
  return payload;
}

export function assertRequestHasNoGold(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Request export leaked forbidden key ${key}`);
    }
  }
}
