import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Paper } from "./types.js";

const processedPapersFileSchema = z.object({
  reportDate: z.string(),
  generatedAt: z.string().optional(),
  papers: z.array(z.custom<Paper>()),
});

export type ProcessedPapersFile = z.infer<typeof processedPapersFileSchema>;

export async function readProcessedPapersFile(path: string): Promise<ProcessedPapersFile> {
  const raw = await readFile(path, "utf8");
  const parsed = processedPapersFileSchema.parse(JSON.parse(raw));
  return parsed;
}

export function processedPapersPath(reportDate: string): string {
  return `data/processed/${reportDate}/papers.json`;
}
