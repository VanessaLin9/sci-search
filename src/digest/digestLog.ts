/** Digest-phase logs (when ENABLE_LLM_DIGEST=1; not gated by DEBUG_NORMALIZED). */
export function logDigest(message: string): void {
  console.log(`[digest] ${message}`);
}

export function formatElapsedMs(startedAt: number): string {
  const seconds = (Date.now() - startedAt) / 1000;
  return seconds >= 60 ? `${(seconds / 60).toFixed(1)}m` : `${seconds.toFixed(1)}s`;
}
