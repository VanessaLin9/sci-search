import type { LlmModelUsage } from "../llm/llmModelUsage.js";
import type {
  BroadScienceRoutingInput as DomainBroadScienceRoutingInput,
  ExcludedPaper as DomainExcludedPaper,
  LifeScienceRoutingResult as DomainLifeScienceRoutingResult,
  LifeScienceRoutingStats as DomainLifeScienceRoutingStats,
} from "../domain/life-science/routing/types.js";

export type BroadScienceRoutingInput = DomainBroadScienceRoutingInput;
export type ExcludedPaper<P = DomainExcludedPaper["paper"]> = DomainExcludedPaper<P>;
export type LifeScienceRoutingStats = DomainLifeScienceRoutingStats;

/** Orchestrator result: domain routing outcome plus optional runtime model usage. */
export type LifeScienceRoutingResult<P = DomainExcludedPaper["paper"]> =
  DomainLifeScienceRoutingResult<P> & {
    model?: LlmModelUsage;
  };
