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

/** Orchestrator 附加當日 routing model（PR #40）；不進 domain 政策型別。 */
export type LifeScienceRoutingResult<P = DomainExcludedPaper["paper"]> =
  DomainLifeScienceRoutingResult<P> & {
    model?: LlmModelUsage;
  };
