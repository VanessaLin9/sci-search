const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "have", "has", "had", "having", "do", "does", "did", "doing",
  "will", "would", "could", "should", "may", "might", "must", "shall", "can",
  "of", "in", "to", "for", "with", "on", "at", "by", "from", "as", "into",
  "that", "this", "these", "those", "it", "its", "they", "them", "their",
  "not", "no", "only", "also", "just", "very", "more", "most", "other", "some",
  "using", "use", "used", "show", "shows", "study", "studies", "new", "novel",
]);

const ALLOW_SHORT = new Set(["mr", "ai", "ls", "qc", "iv"]);

export function normalizeRoutingKeywordStem(token: string): string {
  let t = token.toLowerCase();
  if (t.length <= 2) return t;

  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith("oes") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ves") && t.length > 4) return `${t.slice(0, -3)}f`;
  if (t.endsWith("ses") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ches") || t.endsWith("shes") || t.endsWith("xes") || t.endsWith("zes")) {
    return t.slice(0, -2);
  }
  if (t.endsWith("es") && t.length > 3) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) return t.slice(0, -1);
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("edly") && t.length > 6) return t.slice(0, -4);
  if (t.endsWith("ly") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("en") && t.length > 4) return t.slice(0, -2);
  return t;
}

export function tokenizeRoutingTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9+-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      if (ALLOW_SHORT.has(token)) return true;
      if (token.length < 3) return false;
      if (/^\d+$/.test(token)) return false;
      return !STOP_WORDS.has(token);
    });
}

export function stemRoutingTitle(title: string): Set<string> {
  const stems = new Set<string>();
  for (const token of tokenizeRoutingTitle(title)) {
    stems.add(normalizeRoutingKeywordStem(token));
  }
  return stems;
}
