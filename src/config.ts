import { readFileSync } from "node:fs";
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

const routingFileSchema = z.object({
  baseUrl: z.string().url(),
  maxPapersPerBatch: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  enableThinking: z.boolean(),
});

export type RoutingFileConfig = z.infer<typeof routingFileSchema>;

const digestFileSchema = z.object({
  maxFeatured: z.number().int().positive(),
  overflowShowTitleZh: z.boolean(),
  baseUrl: z.string().url(),
  maxPapersPerBatch: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  enableThinking: z.boolean(),
});

export type DigestFileConfig = z.infer<typeof digestFileSchema>;

let routingFileCache: RoutingFileConfig | undefined;
let digestFileCache: DigestFileConfig | undefined;

export async function loadSources(path = "config/sources.json"): Promise<Source[]> {
  const raw = await readFile(path, "utf8");
  return z.array(sourceSchema).parse(JSON.parse(raw));
}

export async function loadKeywords(path = "config/keywords.json") {
  const raw = await readFile(path, "utf8");
  return keywordsSchema.parse(JSON.parse(raw));
}

export function loadRoutingFileConfig(path = "config/routing.json"): RoutingFileConfig {
  if (!routingFileCache) {
    const raw = readFileSync(path, "utf8");
    routingFileCache = routingFileSchema.parse(JSON.parse(raw));
  }
  return routingFileCache;
}

export function loadDigestFileConfig(path = "config/digest.json"): DigestFileConfig {
  if (!digestFileCache) {
    const raw = readFileSync(path, "utf8");
    digestFileCache = digestFileSchema.parse(JSON.parse(raw));
  }
  return digestFileCache;
}
