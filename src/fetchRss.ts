import Parser from "rss-parser";
import type { Source } from "./types.js";

const parser = new Parser({
  customFields: {
    item: [
      ["dc:source", "source"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

export async function fetchRssSource(source: Source) {
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "paper-digest/0.1 (+https://github.com/)",
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.id}: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return parser.parseString(xml);
}
