import { readFile } from "node:fs/promises";
import { contentHash, sha256Hex } from "./hash.js";
import type { LifeScienceGateDataset } from "./types.js";
import { assertDatasetUsable, validateLifeScienceGateDataset } from "./validateDataset.js";

export type LoadedDataset = {
  dataset: LifeScienceGateDataset;
  fileHash: string;
  contentHash: string;
  path: string;
};

export async function loadDatasetFromPath(path: string): Promise<LoadedDataset> {
  const raw = await readFile(path, "utf8");
  return loadDatasetFromRaw(raw, path);
}

export function loadDatasetFromRaw(raw: string, path = "<memory>"): LoadedDataset {
  const parsed: unknown = JSON.parse(raw);
  const { dataset, issues } = validateLifeScienceGateDataset(parsed);
  assertDatasetUsable(issues);
  return {
    dataset,
    fileHash: sha256Hex(raw),
    contentHash: contentHash(dataset),
    path,
  };
}
