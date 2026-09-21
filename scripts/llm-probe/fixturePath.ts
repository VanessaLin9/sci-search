import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to `scripts/llm-probe/`. */
export function probeRootDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Absolute path under `scripts/llm-probe/fixtures/`. */
export function fixturePath(...parts: string[]): string {
  return join(probeRootDir(), "fixtures", ...parts);
}
