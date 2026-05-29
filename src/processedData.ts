import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  digestLineSchema,
  digestTaggingMethodSchema,
  lifeScienceRoutingExclusionReasonSchema,
  lifeScienceRoutingExclusionVerdictSchema,
  lifeScienceRoutingSchema,
  paperSectionSchema,
} from "./domain/life-science/index.js";
import type { ClassifiedPaper } from "./types.js";
import type { ExcludedPaper, LifeScienceRoutingStats } from "./routing/types.js";

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
});

const routingStatsSchema = z.object({
  total: z.number(),
  passedByScope: z.number(),
  llmClassified: z.number(),
  llmYes: z.number(),
  llmNotSure: z.number(),
  llmNo: z.number(),
  included: z.number(),
  excluded: z.number(),
}) satisfies z.ZodType<LifeScienceRoutingStats>;

const digestStatsSchema = z.object({
  enabled: z.boolean(),
  llmTagging: z.boolean(),
  tagging: z.object({
    llmClassified: z.number(),
    llmTagged: z.number(),
    fallback: z.number(),
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
  }),
  summarize: z
    .object({
      requested: z.number(),
      llmSummarized: z.number(),
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
});

const processedPapersFileSchema = z.object({
  reportDate: z.string(),
  generatedAt: z.string().optional(),
  papers: z.array(classifiedPaperSchema),
  routing: z
    .object({
      enabled: z.boolean(),
      stats: routingStatsSchema,
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
  };
  digest?: z.infer<typeof digestStatsSchema>;
  excludedPapers?: ExcludedPaper[];
};

export async function readProcessedPapersFile(path: string): Promise<ProcessedPapersFile> {
  const raw = await readFile(path, "utf8");
  return validateProcessedPapersFile(JSON.parse(raw));
}

export function validateProcessedPapersFile(data: unknown): ProcessedPapersFile {
  return processedPapersFileSchema.parse(data) as ProcessedPapersFile;
}

export function processedPapersPath(reportDate: string): string {
  return `data/processed/${reportDate}/papers.json`;
}
