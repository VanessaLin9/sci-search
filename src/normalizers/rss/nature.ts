import type { Item } from "rss-parser";

/** Nature main RSS blurbs are unreliable; type and abstract come from HTML enrich. */
export function extractNatureMainAbstract(_item: Item): string | undefined {
  return undefined;
}
