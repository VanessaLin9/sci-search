/** Subject `${subjectPrefix} · ${date} (${n} papers)`; n excludes skip (INV-042). */
export function buildDigestSubject(
  reportDate: string,
  visiblePaperCount: number,
  subjectPrefix: string,
): string {
  return `${subjectPrefix} · ${reportDate} (${visiblePaperCount} papers)`;
}
