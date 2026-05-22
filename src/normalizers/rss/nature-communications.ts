import type { Item } from "rss-parser";
import { normalizeWhitespace, stripHtml } from "../shared.js";

type NatureCommunicationsItem = Item & {
  contentEncoded?: string;
};

const NCOMMS_HEADER_HTML =
  /^\s*<p>\s*Nature Communications, Published online:[\s\S]*?<\/p>\s*/i;

const NCOMMS_HEADER_TEXT =
  /^Nature Communications, Published online:[^;]+;\s*(?:doi:\S+\s*)?/i;

export function isNatureCommunicationsSkippedItem(item: Item): boolean {
  const title = item.title?.trim() ?? "";
  return /^(Author|Publisher) Correction:/i.test(title);
}

export function extractNatureCommunicationsAbstract(item: Item): string | undefined {
  const rssItem = item as NatureCommunicationsItem;
  const raw = (rssItem.contentEncoded ?? rssItem.content)?.trim();
  if (!raw) return undefined;

  const withoutHtmlHeader = NCOMMS_HEADER_HTML.test(raw) ? raw.replace(NCOMMS_HEADER_HTML, "") : raw;
  let normalized = normalizeWhitespace(stripHtml(withoutHtmlHeader));
  normalized = normalized.replace(NCOMMS_HEADER_TEXT, "").trim();

  if (!normalized || normalized.length < 40) return undefined;

  return normalized;
}
