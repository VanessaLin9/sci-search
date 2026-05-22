import type { Item } from "rss-parser";
import { extractNatureEncodedAbstract, isNatureEncodedSkippedItem } from "./nature-encoded.js";

const JOURNAL_NAME = "Nature Microbiology";

export const isNatureMicrobiologySkippedItem = isNatureEncodedSkippedItem;

export function extractNatureMicrobiologyAbstract(item: Item): string | undefined {
  return extractNatureEncodedAbstract(item, JOURNAL_NAME);
}
