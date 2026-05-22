import type { Item } from "rss-parser";
import { normalizeWhitespace, stripHtml } from "../shared.js";

type NatureEncodedItem = Item & {
  contentEncoded?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function journalPattern(journalName: string): string {
  return escapeRegExp(journalName).replace(/&/g, "(?:&amp;|&)");
}

function buildHeaderHtmlPattern(journalName: string): RegExp {
  return new RegExp(
    `^\\s*<p>\\s*${journalPattern(journalName)}, Published online:[\\s\\S]*?<\\/p>\\s*`,
    "i",
  );
}

function buildHeaderTextPattern(journalName: string): RegExp {
  return new RegExp(
    `^${journalPattern(journalName)}, Published online:[^;]+;\\s*(?:doi:\\S+\\s*)?`,
    "i",
  );
}

export function isNatureEncodedSkippedItem(item: Item): boolean {
  const title = item.title?.trim() ?? "";
  return (
    /^(Author|Publisher) Correction:/i.test(title) ||
    /^Reply to:/i.test(title)
  );
}

export function extractNatureEncodedAbstract(item: Item, journalName: string): string | undefined {
  const rssItem = item as NatureEncodedItem;
  const raw = (rssItem.contentEncoded ?? rssItem.content)?.trim();
  if (!raw) return undefined;

  const headerHtml = buildHeaderHtmlPattern(journalName);
  const withoutHtmlHeader = headerHtml.test(raw) ? raw.replace(headerHtml, "") : raw;
  let normalized = normalizeWhitespace(stripHtml(withoutHtmlHeader));
  normalized = normalized.replace(buildHeaderTextPattern(journalName), "").trim();

  if (!normalized || normalized.length < 40) return undefined;

  return normalized;
}
