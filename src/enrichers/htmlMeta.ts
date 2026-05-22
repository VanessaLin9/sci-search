import { normalizeWhitespace, stripHtml } from "../normalizers/shared.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractMetaByName(html: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return undefined;
}

export function extractMetaByProperty(html: string, property: string): string | undefined {
  const escaped = escapeRegExp(property);
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return undefined;
}

export function extractNatureAbs1Section(html: string): string | undefined {
  const sectionMatch = html.match(/id=["']Abs1-section["'][\s\S]*?<\/div>\s*<\/div>/i);
  if (!sectionMatch) return undefined;

  const contentMatch = sectionMatch[0].match(
    /class=["'][^"']*c-article-section__content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!contentMatch?.[1]) return undefined;

  const normalized = normalizeWhitespace(stripHtml(contentMatch[1]));
  return normalized || undefined;
}

function decodeHtmlEntities(value: string): string {
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
