import { z } from "zod";
import {
  DIGEST_LINES,
  DIGEST_TAGGING_METHODS,
  LIFE_SCIENCE_ROUTING_EXCLUSION_REASON,
  LIFE_SCIENCE_ROUTING_METHODS,
  LIFE_SCIENCE_ROUTING_VERDICTS,
  PAPER_SECTIONS,
  SOURCE_SCOPES,
} from "./constants.js";
import type { LifeScienceRouting } from "./types.js";

export const sourceScopeSchema = z.enum(SOURCE_SCOPES);

export const paperSectionSchema = z.enum(PAPER_SECTIONS);

export const digestLineSchema = z.enum(DIGEST_LINES);

export const digestTaggingMethodSchema = z.enum(DIGEST_TAGGING_METHODS);

export const lifeScienceRoutingVerdictSchema = z.enum(LIFE_SCIENCE_ROUTING_VERDICTS);

export const lifeScienceRoutingMethodSchema = z.enum(LIFE_SCIENCE_ROUTING_METHODS);

export const lifeScienceRoutingSchema = z.object({
  verdict: lifeScienceRoutingVerdictSchema,
  method: lifeScienceRoutingMethodSchema,
}) satisfies z.ZodType<LifeScienceRouting>;

export const lifeScienceRoutingExclusionReasonSchema = z.literal(LIFE_SCIENCE_ROUTING_EXCLUSION_REASON);

export const lifeScienceRoutingExclusionVerdictSchema = z.literal("no");
