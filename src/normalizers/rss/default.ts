import type { Item } from "rss-parser";
import { normalizeWhitespace, stripHtml } from "../shared.js";

export function extractDefaultRssAbstract(item: Item): string | undefined {
  const raw = item.contentSnippet ?? item.summary ?? item.content;
  if (!raw) return undefined;

  const text = /<[a-z][\s\S]*>/i.test(raw) ? stripHtml(raw) : raw;
  const normalized = normalizeWhitespace(text);
  return normalized || undefined;
}
