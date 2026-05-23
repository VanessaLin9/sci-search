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

const NATURE_RSS_TEASER_VERB =
  "report|reports|show|shows|find|finds|reveal|reveals|demonstrate|identify|discuss|uncover|describe|develop|use|provide|highlight|present|determine";

/** Nature RSS often ships a one-line "Author et al. report …" blurb instead of the paper abstract. */
export function isNatureRssTeaserAbstract(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  return new RegExp(`\\bet al\\.\\s+(${NATURE_RSS_TEASER_VERB})\\b`, "i").test(normalized);
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
  if (isNatureRssTeaserAbstract(normalized)) return undefined;

  return normalized;
}
