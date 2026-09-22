import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  digestLineSchema,
  digestTaggingMethodSchema,
  lifeScienceRoutingExclusionReasonSchema,
  lifeScienceRoutingExclusionVerdictSchema,
  lifeScienceRoutingMethodSchema,
  lifeScienceRoutingSchema,
  paperSectionSchema,
} from "./domain/life-science/index.js";
import type { ClassifiedPaper } from "./types.js";
import type { ExcludedPaper, LifeScienceRoutingResult, LifeScienceRoutingStats } from "./routing/types.js";
import type { DigestPhaseResult } from "./digest/types.js";
import {
  sanitizeDigestLlmModelsSnapshot,
  sanitizePersistedLlmModelUsage,
  type DigestLlmModelsSnapshot,
  type LlmModelUsage,
} from "./llm/llmModelUsage.js";

// Pre-classify shape: routing happens before classify, so excluded papers never carry these fields.
// Kept optional+strip-tolerant so legacy JSON files (which embedded the placeholder values) still parse.
const rawPaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  journal: z.string(),
  publishedDate: z.string(),
  url: z.string(),
  doi: z.string().optional(),
  abstract: z.string().optional(),
  articleType: z.string().optional(),
  authors: z.array(z.string()).optional(),
  sourceId: z.string(),
  lifeScienceRouting: lifeScienceRoutingSchema.optional(),
  matchedKeywords: z.array(z.string()).optional(),
  section: paperSectionSchema.optional(),
  digestLine: digestLineSchema.optional(),
  digestTaggingMethod: digestTaggingMethodSchema.optional(),
  featured: z.boolean().optional(),
  titleZh: z.string().optional(),
  summaryZh: z.string().optional(),
  topicTags: z.array(z.string()).optional(),
});

const classifiedPaperSchema = rawPaperSchema.extend({
  matchedKeywords: z.array(z.string()),
  section: paperSectionSchema,
});

const excludedPaperSchema = z.object({
  paper: rawPaperSchema,
  reason: lifeScienceRoutingExclusionReasonSchema,
  verdict: lifeScienceRoutingExclusionVerdictSchema,
  method: lifeScienceRoutingMethodSchema.optional(),
});

const routingStatsSchema = z.object({
  total: z.number(),
  passedByScope: z.number(),
  llmClassified: z.number(),
  llmYes: z.number(),
  llmNotSure: z.number(),
  llmNo: z.number(),
  keywordFallbackClassified: z.number().default(0),
  keywordFallbackYes: z.number().default(0),
  keywordFallbackNo: z.number().default(0),
  included: z.number(),
  excluded: z.number(),
});

// Optional（PR #40）：舊 papers.json 無 routing.model／digest.models 仍須 parse。
// 殘缺／空字串／缺 primary 丟棄該段 metadata，不讓整份 digest 無法寄出（PR #40 Codex P2）。
const digestStatsSchema = z.object({
  enabled: z.boolean(),
  llmTagging: z.boolean(),
  tagging: z.object({
    llmClassified: z.number(),
    llmTagged: z.number(),
    fallback: z.number(),
    threshold: z.number().optional().default(0),
    llmLineA: z.number().optional().default(0),
    llmLineB: z.number().optional().default(0),
    fallbackLineA: z.number().optional().default(0),
    fallbackLineB: z.number().optional().default(0),
    failures: z.number().optional().default(0),
  }),
  selection: z.object({
    total: z.number(),
    candidates: z.number(),
    featured: z.number(),
    overflow: z.number(),
    lineA: z.number(),
    lineB: z.number(),
    preprint: z.number(),
    skip: z.number(),
    featuredLineA: z.number().optional().default(0),
    featuredLineB: z.number().optional().default(0),
    featuredPreprint: z.number().optional().default(0),
    overflowLineA: z.number().optional().default(0),
    overflowLineB: z.number().optional().default(0),
    overflowPreprint: z.number().optional().default(0),
  }),
  summarize: z
    .object({
      requested: z.number(),
      llmSummarized: z.number(),
      primarySucceeded: z.number().optional(),
      fallbackSucceeded: z.number().optional(),
      failed: z.number(),
    })
    .optional(),
    translate: z
      .object({
        requested: z.number(),
        llmTranslated: z.number(),
        failed: z.number(),
      })
      .optional(),
    models: z.unknown().optional(),
  });

const processedPapersFileSchema = z.object({
  reportDate: z.string(),
  generatedAt: z.string().optional(),
  papers: z.array(classifiedPaperSchema),
  routing: z
    .object({
      enabled: z.boolean(),
      stats: routingStatsSchema,
      model: z.unknown().optional(),
    })
    .optional(),
  digest: digestStatsSchema.optional(),
  excludedPapers: z.array(excludedPaperSchema).optional(),
});

export type ProcessedPapersFile = {
  reportDate: string;
  generatedAt?: string;
  papers: ClassifiedPaper[];
  routing?: {
    enabled: boolean;
    stats: LifeScienceRoutingStats;
    model?: LlmModelUsage;
  };
  digest?: Omit<z.infer<typeof digestStatsSchema>, "models"> & {
    models?: DigestLlmModelsSnapshot;
  };
  excludedPapers?: ExcludedPaper[];
};

/** 把 pipeline 當日 model snapshot 寫進 papers.json；render／寄信只讀檔、不讀當下 env（PR #40）。 */
export function toProcessedPapersFile(input: {
  reportDate: string;
  generatedAt?: string;
  papers: ClassifiedPaper[];
  routing: Pick<LifeScienceRoutingResult, "enabled" | "stats" | "model" | "excluded">;
  digest: DigestPhaseResult;
}): ProcessedPapersFile {
  return {
    reportDate: input.reportDate,
    generatedAt: input.generatedAt,
    papers: input.papers,
    routing: {
      enabled: input.routing.enabled,
      stats: input.routing.stats,
      ...(input.routing.model ? { model: input.routing.model } : {}),
    },
    digest: {
      enabled: input.digest.enabled,
      llmTagging: input.digest.llmTagging,
      tagging: input.digest.tagging,
      selection: input.digest.selection,
      summarize: input.digest.summarize,
      translate: input.digest.translate,
      ...(input.digest.models ? { models: input.digest.models } : {}),
    },
    excludedPapers: input.routing.excluded.length > 0 ? input.routing.excluded : undefined,
  };
}

export async function readProcessedPapersFile(path: string): Promise<ProcessedPapersFile> {
  const raw = await readFile(path, "utf8");
  return validateProcessedPapersFile(JSON.parse(raw));
}

export function validateProcessedPapersFile(data: unknown): ProcessedPapersFile {
  const parsed = processedPapersFileSchema.parse(data);
  const routingModel = parsed.routing
    ? sanitizePersistedLlmModelUsage(parsed.routing.model)
    : undefined;
  return {
    ...parsed,
    routing: parsed.routing
      ? {
          enabled: parsed.routing.enabled,
          stats: {
            ...parsed.routing.stats,
            keywordFallbackClassified: parsed.routing.stats.keywordFallbackClassified ?? 0,
            keywordFallbackYes: parsed.routing.stats.keywordFallbackYes ?? 0,
            keywordFallbackNo: parsed.routing.stats.keywordFallbackNo ?? 0,
          },
          ...(routingModel ? { model: routingModel } : {}),
        }
      : undefined,
    digest: parsed.digest
      ? {
          ...parsed.digest,
          models: sanitizeDigestLlmModelsSnapshot(parsed.digest.models),
        }
      : undefined,
  } as ProcessedPapersFile;
}

export function processedPapersPath(reportDate: string): string {
  return `data/processed/${reportDate}/papers.json`;
}
