/** Feature flag for Phase 2a life-science routing (env name unchanged). */
export function isLifeScienceRoutingEnabled(): boolean {
  const flag = process.env.ROUTE_LIFE_SCIENCE?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}
