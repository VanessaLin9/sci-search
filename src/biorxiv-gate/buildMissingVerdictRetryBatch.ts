/** Build the one retry batch for missing verdicts (id-only; gate inputs vary by field). */
export function buildMissingVerdictRetryBatch<T extends { id: string }>(
  items: T[],
  missingIds: string[],
): T[] {
  if (missingIds.length === 0) return [];
  if (missingIds.length > 1) {
    const missingSet = new Set(missingIds);
    return items.filter((item) => missingSet.has(item.id));
  }

  const missingId = missingIds[0]!;
  const mid = Math.ceil(items.length / 2);
  const firstHalf = items.slice(0, mid);
  if (firstHalf.some((item) => item.id === missingId)) {
    return firstHalf;
  }
  return items.slice(mid);
}
