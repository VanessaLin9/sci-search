import { decodeHtmlEntities, normalizeWhitespace, stripHtml } from "./normalizers/shared.js";

const CROSSREF_USER_AGENT = "paper-digest/0.1 (mailto:septem1412@gmail.com)";
const MIN_ABSTRACT_LENGTH = 80;

/** Crossref often returns JATS XML in abstract, e.g. `<jats:p>...</jats:p>`. */
export function stripJatsMarkup(value: string): string {
  const decoded = decodeHtmlEntities(value);
  return stripHtml(decoded);
}

function abstractFromCrossrefMessage(message: {
  abstract?: string | Array<{ text?: string }>;
}): string | undefined {
  let raw: string | undefined;

  if (typeof message.abstract === "string") {
    raw = message.abstract;
  } else if (Array.isArray(message.abstract)) {
    raw = message.abstract.map((part) => part.text ?? "").join(" ");
  }

  if (!raw) return undefined;

  const normalized = stripJatsMarkup(raw);
  if (normalized.length < MIN_ABSTRACT_LENGTH) return undefined;
  if (/<jats\b|<\/?[a-z]/i.test(normalized)) return undefined;

  return normalized;
}

export async function fetchAbstractFromCrossref(doi: string): Promise<string | undefined> {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": CROSSREF_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Crossref request failed for ${doi}: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { message?: { abstract?: string | Array<{ text?: string }> } };
  return abstractFromCrossrefMessage(payload.message ?? {});
}
