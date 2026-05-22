import type { Item } from "rss-parser";

/** Nature Methods RSS does not include abstract; enrichment fetches article pages later. */
export function extractNatureMethodsAbstract(_item: Item): string | undefined {
  return undefined;
}
