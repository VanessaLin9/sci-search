import { ROUTING_SYSTEM_PROMPT } from "../../domain/life-science/prompts/routing.system.js";
import { matchRoutingKeywordFallback } from "../../domain/life-science/routing/keywordFallbackMatcher.js";
import type { RoutingKeywordsConfig } from "../../domain/life-science/routing/keywordFallbackMatcher.js";
import { LIFE_SCIENCE_GATE_POLICY_ID } from "./constants.js";
import { sha256Hex } from "./hash.js";
import type { PredictionErrorKind, RoutingVerdict } from "./types.js";

export function lifeScienceGatePolicyHash(prompt: string = ROUTING_SYSTEM_PROMPT): string {
  return sha256Hex(prompt);
}

export function currentLifeScienceGatePolicy(): { policyId: string; policyHash: string } {
  return {
    policyId: LIFE_SCIENCE_GATE_POLICY_ID,
    policyHash: lifeScienceGatePolicyHash(),
  };
}

export function productOutcomeFromVerdict(verdict: RoutingVerdict): "include" | "exclude" {
  return verdict === "no" ? "exclude" : "include";
}

export type ModelOrFallbackOutcome = {
  modelOutcome: "include" | "exclude" | "unavailable";
  fallbackApplied: boolean;
  fallbackOutcome: "include" | "exclude" | "unavailable";
  fallbackMethod: "none" | "routing-keyword-fallback";
};

export function modelAndFallbackOutcomes(options: {
  verdict?: RoutingVerdict;
  errorKind?: PredictionErrorKind;
  title: string;
  keywordConfig: RoutingKeywordsConfig;
}): ModelOrFallbackOutcome {
  if (options.errorKind || !options.verdict) {
    const fallback = matchRoutingKeywordFallback(options.title, options.keywordConfig);
    return {
      modelOutcome: "unavailable",
      fallbackApplied: true,
      fallbackOutcome: productOutcomeFromVerdict(fallback.verdict),
      fallbackMethod: "routing-keyword-fallback",
    };
  }

  const modelOutcome = productOutcomeFromVerdict(options.verdict);
  return {
    modelOutcome,
    fallbackApplied: false,
    fallbackOutcome: modelOutcome,
    fallbackMethod: "none",
  };
}
