import { z } from "zod";
import {
  ANNOTATION_STATUSES,
  DATASET_SPLITS,
  HARD_TAGS,
  HISTORICAL_METHODS,
  LIFE_SCIENCE_GATE_DATASET_ID,
  LIFE_SCIENCE_GATE_FALLBACK_POLICY_ID,
  LIFE_SCIENCE_GATE_POLICY_ID,
  PREDICTION_ERROR_KINDS,
  PROVENANCE_KINDS,
  ROUTING_VERDICTS,
  SAMPLE_GROUPS,
} from "./constants.js";
import type { LifeScienceGateDataset, PredictionRun } from "./types.js";

export const routingVerdictSchema = z.enum(ROUTING_VERDICTS);

export const gateModelInputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    journal: z.string().min(1),
    source_id: z.string().min(1),
  })
  .strict();

const historicalObservationSchema = z
  .object({
    reportDate: z.string().min(1),
    included: z.boolean(),
    verdict: routingVerdictSchema.nullable(),
    method: z.enum(HISTORICAL_METHODS).nullable(),
    path: z.string().min(1),
    gitCommit: z.string().min(1).nullable(),
  })
  .strict();

export const lifeScienceGateCaseSchema = z
  .object({
    caseId: z.string().min(1),
    groupId: z.string().min(1),
    input: gateModelInputSchema,
    provenance: z
      .object({
        kind: z.enum(PROVENANCE_KINDS),
        reportDate: z.string().min(1),
        path: z.string().min(1),
        gitCommit: z.string().min(1).nullable(),
        recoverableExcluded: z.boolean(),
        notes: z.string().optional(),
      })
      .strict(),
    sampleGroup: z.enum(SAMPLE_GROUPS),
    hardTags: z.array(z.enum(HARD_TAGS)),
    split: z.enum(DATASET_SPLITS),
    annotationStatus: z.enum(ANNOTATION_STATUSES),
    draftVerdict: routingVerdictSchema,
    draftReason: z.string().min(1),
    draftAnnotator: z
      .object({
        kind: z.literal("ai-draft"),
        model: z.string().min(1),
        promptVersion: z.string().min(1),
        policyId: z.string().min(1),
        policyHash: z.string().min(1),
      })
      .strict(),
    goldVerdict: routingVerdictSchema.nullable(),
    goldReason: z.string().nullable(),
    reviewer: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    historical: z
      .object({
        referenceOnly: z.literal(true),
        observations: z.array(historicalObservationSchema).min(1),
      })
      .strict(),
  })
  .strict();

export const lifeScienceGateDatasetSchema = z
  .object({
    datasetId: z.literal(LIFE_SCIENCE_GATE_DATASET_ID),
    datasetVersion: z.string().min(1),
    policyId: z.literal(LIFE_SCIENCE_GATE_POLICY_ID),
    policyHash: z.string().min(1),
    fallbackPolicy: z
      .object({
        id: z.literal(LIFE_SCIENCE_GATE_FALLBACK_POLICY_ID),
        hash: z.string().min(1),
        keywords: z
          .object({
            includeStems: z.array(z.string()),
            includeTerms: z.array(z.string()),
            sharedIncludeTerms: z.array(z.string()),
            excludeTerms: z.array(z.string()),
            excludePhrases: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    createdAt: z.string().min(1),
    changelog: z.array(z.string()),
    sampling: z
      .object({
        seed: z.number().int(),
        dateRange: z
          .object({
            start: z.string().min(1),
            end: z.string().min(1),
          })
          .strict(),
        targetSize: z.number().int().positive(),
        devFraction: z.number().gt(0).lt(1),
        quotas: z.record(z.string(), z.number()),
        notes: z.array(z.string()),
      })
      .strict(),
    inventoryGaps: z.array(
      z
        .object({
          id: z.string().min(1),
          detail: z.string().min(1),
        })
        .strict(),
    ),
    cases: z.array(lifeScienceGateCaseSchema).min(1),
  })
  .strict() satisfies z.ZodType<LifeScienceGateDataset>;

export const predictionRowSchema = z
  .object({
    caseId: z.string().min(1),
    verdict: routingVerdictSchema.optional(),
    errorKind: z.enum(PREDICTION_ERROR_KINDS).optional(),
    latencyMs: z.number().nonnegative().nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
    tokens: z.number().nonnegative().nullable().optional(),
  })
  .strict();

export const predictionRunSchema = z
  .object({
    runId: z.string().min(1),
    datasetVersion: z.string().min(1),
    datasetHash: z.string().min(1),
    model: z.string().min(1),
    provider: z.string().min(1),
    promptVersion: z.string().min(1),
    promptHash: z.string().min(1),
    split: z.enum(DATASET_SPLITS).optional(),
    predictions: z.array(predictionRowSchema),
  })
  .strict() satisfies z.ZodType<PredictionRun>;
