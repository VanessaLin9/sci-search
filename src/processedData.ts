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
import type { LlmModelUsage } from "./llm/llmModelUsage.js";

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

const llmModelUsageSchema = z.object({
  requested: z.string().min(1),
  observed: z.array(z.string().min(1)).optional(),
});

const digestModelsSchema = z
  .object({
    spatial: llmModelUsageSchema
      .extend({
        llmTagged: z.number().optional(),
      })
      .optional(),
    summarize: z
      .object({
        requested: z.number(),
        failed: z.number(),
        primary: llmModelUsageSchema.extend({ succeeded: z.number() }),
        fallback: llmModelUsageSchema.extend({ succeeded: z.number() }).optional(),
      })
      .optional(),
    translate: z
      .object({
        requested: z.number(),
        succeeded: z.number(),
        failed: z.number(),
        model: llmModelUsageSchema,
      })
      .optional(),
  })
  .optional();

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
    models: digestModelsSchema,
  });

const processedPapersFileSchema = z.object({
  reportDate: z.string(),
  generatedAt: z.string().optional(),
  papers: z.array(classifiedPaperSchema),
  routing: z
    .object({
      enabled: z.boolean(),
      stats: routingStatsSchema,
      model: llmModelUsageSchema.optional(),
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
  digest?: z.infer<typeof digestStatsSchema>;
  excludedPapers?: ExcludedPaper[];
};

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
  return {
    ...parsed,
    routing: parsed.routing
      ? {
          ...parsed.routing,
          stats: {
            ...parsed.routing.stats,
            keywordFallbackClassified: parsed.routing.stats.keywordFallbackClassified ?? 0,
            keywordFallbackYes: parsed.routing.stats.keywordFallbackYes ?? 0,
            keywordFallbackNo: parsed.routing.stats.keywordFallbackNo ?? 0,
          },
        }
      : undefined,
  } as ProcessedPapersFile;
}

export function processedPapersPath(reportDate: string): string {
  return `data/processed/${reportDate}/papers.json`;
}
