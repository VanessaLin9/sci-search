import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Probe 路徑契約（PR #39）：fixtures 進 git，預設不依賴會被 prune 的
 * `data/processed/{date}/`，換 model 時可重複跑同一測資。
 */

/** Absolute path to `scripts/llm-probe/`. */
export function probeRootDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Absolute path under `scripts/llm-probe/fixtures/`. */
export function fixturePath(...parts: string[]): string {
  return join(probeRootDir(), "fixtures", ...parts);
}
