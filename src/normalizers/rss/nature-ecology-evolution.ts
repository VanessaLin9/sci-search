import type { Item } from "rss-parser";
import { extractNatureEncodedAbstract, isNatureEncodedSkippedItem } from "./nature-encoded.js";

const JOURNAL_NAME = "Nature Ecology & Evolution";

export const isNatureEcologyEvolutionSkippedItem = isNatureEncodedSkippedItem;

export function extractNatureEcologyEvolutionAbstract(item: Item): string | undefined {
  return extractNatureEncodedAbstract(item, JOURNAL_NAME);
}
