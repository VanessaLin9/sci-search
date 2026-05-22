import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJsonFile(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
