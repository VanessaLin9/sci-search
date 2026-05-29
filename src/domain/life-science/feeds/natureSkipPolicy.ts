import type { Item } from "rss-parser";

/** Skips non-research Nature RSS items (Author/Publisher Correction, Reply to) — INV-050. */
export function isNatureEncodedSkippedItem(item: Item): boolean {
  const title = item.title?.trim() ?? "";
  return (
    /^(Author|Publisher) Correction:/i.test(title) ||
    /^Reply to:/i.test(title)
  );
}
