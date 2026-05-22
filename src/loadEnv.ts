import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(path = ".env"): void {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) return;

  process.loadEnvFile(absolutePath);
}
