import type { Item } from "rss-parser";

/** Nature Portfolio RSS (Nature, Nature Methods, etc.) has no abstract; enrich fetches article pages. */
export function extractNatureMethodsAbstract(_item: Item): string | undefined {
  return undefined;
}
