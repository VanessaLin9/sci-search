/** Parse DIGEST_TO_EMAIL from .env: JSON array or comma/semicolon-separated list. */
export function parseRecipientList(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupeEmails(
          parsed
            .map((entry) => String(entry).trim())
            .filter(Boolean),
        );
      }
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return dedupeEmails(
    trimmed
      .split(/[,;]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const email of emails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(email);
  }

  return result;
}
