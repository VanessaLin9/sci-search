import type { Item } from "rss-parser";
import { extractNatureEncodedAbstract, isNatureEncodedSkippedItem } from "./nature-encoded.js";

const JOURNAL_NAME = "Nature Cell Biology";

export const isNatureCellBiologySkippedItem = isNatureEncodedSkippedItem;

export function extractNatureCellBiologyAbstract(item: Item): string | undefined {
  return extractNatureEncodedAbstract(item, JOURNAL_NAME);
}
