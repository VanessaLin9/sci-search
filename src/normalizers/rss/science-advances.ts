import type { Item } from "rss-parser";

/** Science Advances etoc RSS only has issue boilerplate, not article abstracts. */
export function extractScienceAdvancesAbstract(_item: Item): string | undefined {
  return undefined;
}
