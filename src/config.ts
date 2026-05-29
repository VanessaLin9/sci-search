import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  LIFE_SCIENCE_DIGEST_POLICY,
  LIFE_SCIENCE_EMAIL_BRANDING,
  LIFE_SCIENCE_KEYWORDS,
  SOURCE_SCOPE_BY_ID,
  sourceScopeSchema,
  type LifeScienceKeywordsConfig,
} from "./domain/life-science/index.js";
import type { Source } from "./types.js";

const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  publisher: z.string(),
  kind: z.enum(["rss", "biorxiv-api", "csv"]),
  url: z.string().url(),
  priority: z.number(),
  scope: sourceScopeSchema,
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
  maxRetries: z.number().int().nonnegative(),
  summarizeTimeoutMs: z.number().int().positive(),
  summarizeMaxRetries: z.number().int().nonnegative(),
  enableThinking: z.boolean(),
  summarizeConcurrency: z.number().int().positive(),
});

export type DigestFileConfig = z.infer<typeof digestFileSchema>;

const emailFileSchema = z.object({
  fromEmail: z.string().email(),
  fromName: z.string().trim().min(1).optional(),
  subjectPrefix: z.string().min(1),
});

export type EmailFileConfig = z.infer<typeof emailFileSchema>;

let routingFileCache: RoutingFileConfig | undefined;
let digestFileCache: DigestFileConfig | undefined;
let emailFileCache: EmailFileConfig | undefined;

export async function loadSources(path = "config/sources.json"): Promise<Source[]> {
  const raw = await readFile(path, "utf8");
  const sources = z.array(sourceSchema).parse(JSON.parse(raw));

  for (const source of sources) {
    const expectedScope = SOURCE_SCOPE_BY_ID[source.id as keyof typeof SOURCE_SCOPE_BY_ID];
    if (expectedScope === undefined || source.scope !== expectedScope) {
      throw new Error(
        `config/sources.json scope for ${source.id} drifted from src/domain/life-science/sources.ts; update domain policy first`,
      );
    }
  }

  const configuredIds = new Set(sources.map((source) => source.id));
  for (const id of Object.keys(SOURCE_SCOPE_BY_ID)) {
    if (!configuredIds.has(id)) {
      throw new Error(
        `SOURCE_SCOPE_BY_ID.${id} missing from config/sources.json; update domain policy first`,
      );
    }
  }

  return sources;
}

/** Returns canonical life-science keyword policy (config/keywords.json kept for transition). */
export async function loadKeywords(_path = "config/keywords.json"): Promise<LifeScienceKeywordsConfig> {
  const fromFile = keywordsSchema.parse(
    JSON.parse(await readFile(_path, "utf8")),
  ) satisfies LifeScienceKeywordsConfig;

  if (
    fromFile.primary.length !== LIFE_SCIENCE_KEYWORDS.primary.length ||
    fromFile.biology.length !== LIFE_SCIENCE_KEYWORDS.biology.length ||
    fromFile.primary.some((keyword, index) => keyword !== LIFE_SCIENCE_KEYWORDS.primary[index]) ||
    fromFile.biology.some((keyword, index) => keyword !== LIFE_SCIENCE_KEYWORDS.biology[index])
  ) {
    throw new Error(
      "config/keywords.json drifted from src/domain/life-science/keywords.ts; update domain policy first",
    );
  }

  return LIFE_SCIENCE_KEYWORDS;
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
    const parsed = digestFileSchema.parse(JSON.parse(raw));
    if (parsed.maxFeatured !== LIFE_SCIENCE_DIGEST_POLICY.maxFeatured) {
      throw new Error(
        `config/digest.json maxFeatured (${parsed.maxFeatured}) drifted from domain policy (${LIFE_SCIENCE_DIGEST_POLICY.maxFeatured})`,
      );
    }
    digestFileCache = parsed;
  }
  return digestFileCache;
}

export function loadEmailFileConfig(path = "config/email.json"): EmailFileConfig {
  if (!emailFileCache) {
    const raw = readFileSync(path, "utf8");
    const parsed = emailFileSchema.parse(JSON.parse(raw));
    if (
      parsed.fromName !== undefined &&
      parsed.fromName !== LIFE_SCIENCE_EMAIL_BRANDING.fromName
    ) {
      throw new Error(
        "config/email.json fromName drifted from src/domain/life-science/emailBranding.ts",
      );
    }
    if (parsed.subjectPrefix !== LIFE_SCIENCE_EMAIL_BRANDING.subjectPrefix) {
      throw new Error(
        "config/email.json subjectPrefix drifted from src/domain/life-science/emailBranding.ts",
      );
    }
    emailFileCache = parsed;
  }
  return emailFileCache;
}
