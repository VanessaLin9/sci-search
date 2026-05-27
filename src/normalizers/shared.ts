export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function stripHtml(html: string): string {
  const withoutTags = decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(withoutTags);
}

const INLINE_FORMAT_TAGS = ["i", "em", "b", "strong", "sup", "sub"] as const;

/** Unwrap inline tags (e.g. gene italics, superscripts) then strip any remaining markup. */
export function stripInlineHtml(html: string): string {
  let text = decodeHtmlEntities(html);

  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of INLINE_FORMAT_TAGS) {
      const next = text.replace(
        new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"),
        "$1",
      );
      if (next !== text) {
        changed = true;
        text = next;
      }
    }
  }

  if (/<[a-z][\s\S]*>/i.test(text)) {
    return stripHtml(text);
  }

  return normalizeWhitespace(text);
}
