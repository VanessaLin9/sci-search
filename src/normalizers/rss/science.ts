import type { Item } from "rss-parser";

/** Science First Release RSS only has issue boilerplate, not article abstracts. */
export function extractScienceAbstract(_item: Item): string | undefined {
  return undefined;
}
