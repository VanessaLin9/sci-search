import type { Item } from "rss-parser";
import { extractNatureEncodedAbstract, isNatureEncodedSkippedItem } from "./nature-encoded.js";

const JOURNAL_NAME = "Nature Biotechnology";

export const isNatureBiotechnologySkippedItem = isNatureEncodedSkippedItem;

export function extractNatureBiotechnologyAbstract(item: Item): string | undefined {
  return extractNatureEncodedAbstract(item, JOURNAL_NAME);
}
