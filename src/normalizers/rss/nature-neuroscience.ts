import type { Item } from "rss-parser";
import { extractNatureEncodedAbstract, isNatureEncodedSkippedItem } from "./nature-encoded.js";

const JOURNAL_NAME = "Nature Neuroscience";

export const isNatureNeuroscienceSkippedItem = isNatureEncodedSkippedItem;

export function extractNatureNeuroscienceAbstract(item: Item): string | undefined {
  return extractNatureEncodedAbstract(item, JOURNAL_NAME);
}
