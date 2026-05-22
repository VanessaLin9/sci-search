import type { Item } from "rss-parser";
import { extractNatureEncodedAbstract, isNatureEncodedSkippedItem } from "./nature-encoded.js";

const JOURNAL_NAME = "Nature Immunology";

export const isNatureImmunologySkippedItem = isNatureEncodedSkippedItem;

export function extractNatureImmunologyAbstract(item: Item): string | undefined {
  return extractNatureEncodedAbstract(item, JOURNAL_NAME);
}
