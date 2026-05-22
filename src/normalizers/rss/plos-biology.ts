import type { Item } from "rss-parser";
import { normalizeWhitespace, stripHtml } from "../shared.js";

const PLOS_AUTHOR_PARAGRAPH_HTML = /^<p>\s*by\b[\s\S]*?<\/p>\s*/i;

export function extractPlosBiologyAbstract(item: Item): string | undefined {
  if (item.content) {
    const fromHtml = extractFromPlosHtml(item.content);
    if (fromHtml) return fromHtml;
  }

  return extractFromPlosSnippet(item.contentSnippet);
}

function extractFromPlosHtml(html: string): string | undefined {
  const body = PLOS_AUTHOR_PARAGRAPH_HTML.test(html)
    ? html.replace(PLOS_AUTHOR_PARAGRAPH_HTML, "")
    : html;
  const normalized = normalizeWhitespace(stripHtml(body));
  return normalized || undefined;
}

function extractFromPlosSnippet(snippet: string | undefined): string | undefined {
  if (!snippet) return undefined;

  const trimmed = snippet.trim();
  if (!/^by\b/i.test(trimmed)) {
    return normalizeWhitespace(trimmed) || undefined;
  }

  const parts = trimmed.split(/\n\s*\n+/).map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(1).join(" ") || undefined;
  }

  return normalizeWhitespace(trimmed.replace(/^by\b[\s\S]*?\n+/i, "")) || undefined;
}
