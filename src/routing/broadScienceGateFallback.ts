import { mergeBroadScienceRoutingResults } from "../domain/life-science/routing/route.js";
import type { LifeScienceRoutingVerdict } from "../types.js";
import { logRouting } from "./routingLog.js";

type RoutablePaper = { id: string; sourceId: string };

export function logRoutingGateDegraded(paperIds: string[], reason: string): void {
  const idList =
    paperIds.length <= 8
      ? paperIds.join(", ")
      : `${paperIds.slice(0, 8).join(", ")}… (+${paperIds.length - 8} more)`;
  logRouting(
    `routing gate degraded: ${paperIds.length} broad-science paper(s) → fallback no (${reason}): ${idList}`,
  );
}

export function mergeBroadScienceWithGateFallback<P extends RoutablePaper>(
  broadScience: P[],
  reason: string,
): ReturnType<typeof mergeBroadScienceRoutingResults<P>> {
  const paperIds = broadScience.map((paper) => paper.id);
  logRoutingGateDegraded(paperIds, reason);
  const verdictById = new Map<string, LifeScienceRoutingVerdict>(
    paperIds.map((id) => [id, "no"]),
  );
  return mergeBroadScienceRoutingResults(broadScience, verdictById);
}
