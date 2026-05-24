/** Routing-phase logs (always on when ROUTE_LIFE_SCIENCE=1; not gated by DEBUG_NORMALIZED). */
export function logRouting(message: string): void {
  console.log(`[routing] ${message}`);
}

export function formatElapsedMs(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}
