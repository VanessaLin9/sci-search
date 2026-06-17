import type { Paper } from "../types.js";
import {
  mergeBroadScienceKeywordFallbackResults,
} from "../domain/life-science/routing/route.js";
import type { BroadScienceMergeResult } from "../domain/life-science/routing/types.js";
import type { RoutingKeywordsConfig } from "../domain/life-science/routing/keywordFallbackMatcher.js";
import { logRouting } from "./routingLog.js";

export function logRoutingGateDegraded(paperIds: string[], reason: string): void {
  const idList =
    paperIds.length <= 8
      ? paperIds.join(", ")
      : `${paperIds.slice(0, 8).join(", ")}… (+${paperIds.length - 8} more)`;
  logRouting(
    `routing gate degraded: ${paperIds.length} broad-science paper(s) → keyword fallback (${reason}): ${idList}`,
  );
}

export function mergeBroadScienceWithKeywordGateFallback<P extends Paper>(
  broadScience: P[],
  reason: string,
  config: RoutingKeywordsConfig,
): BroadScienceMergeResult<P> {
  const paperIds = broadScience.map((paper) => paper.id);
  logRoutingGateDegraded(paperIds, reason);

  const merge = mergeBroadScienceKeywordFallbackResults(broadScience, config);

  logRouting(
    `routing keyword fallback: yes ${merge.keywordFallbackYes}, no ${merge.keywordFallbackNo}`,
  );

  for (const paper of merge.included) {
    const routing = paper.lifeScienceRouting;
    if (routing?.method !== "routing-keyword-fallback") continue;
    logRouting(`routing keyword fallback yes · ${paper.id} · ${paper.title}`);
  }

  for (const entry of merge.excluded) {
    logRouting(`routing keyword fallback no · ${entry.paper.id} · ${entry.paper.title}`);
  }

  return merge;
}
