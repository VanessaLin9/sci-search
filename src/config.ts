import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Source } from "./types.js";

const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  publisher: z.string(),
  kind: z.enum(["rss", "biorxiv-api", "csv"]),
  url: z.string().url(),
  priority: z.number(),
  scope: z.enum(["life-science-only", "broad-science"]),
});

const keywordsSchema = z.object({
  primary: z.array(z.string()),
  biology: z.array(z.string()),
});

export async function loadSources(path = "config/sources.json"): Promise<Source[]> {
  const raw = await readFile(path, "utf8");
  return z.array(sourceSchema).parse(JSON.parse(raw));
}

export async function loadKeywords(path = "config/keywords.json") {
  const raw = await readFile(path, "utf8");
  return keywordsSchema.parse(JSON.parse(raw));
}