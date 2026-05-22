import type { Item } from "rss-parser";
import { extractDoi } from "../../doi.js";

const PNAS_IN_THIS_ISSUE_DOI = /\/iti\d/i;

export function isPnasEditorialRssItem(item: Item): boolean {
  const title = item.title?.trim() ?? "";
  if (/^In This Issue$/i.test(title)) return true;

  const doi = extractDoi(item.link) ?? extractDoi(item.guid);
  if (doi && PNAS_IN_THIS_ISSUE_DOI.test(doi)) return true;

  return false;
}

/** PNAS RSS descriptions are unreliable; leave abstract empty until enrich is implemented. */
export function extractPnasAbstract(_item: Item): string | undefined {
  return undefined;
}
