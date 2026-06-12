import Parser from "rss-parser";
import { looksLikeFeedXml, repairRssXml } from "./sanitizeRssXml.js";
import type { Source } from "./types.js";

export const RSS_FETCH_HEADERS = {
  "User-Agent": "paper-digest/0.1 (+https://github.com/)",
  Accept:
    "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
} as const;

const parser = new Parser({
  customFields: {
    item: [
      ["dc:identifier", "dcIdentifier"],
      ["dc:source", "source"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

export async function fetchRssXml(source: Source): Promise<string> {
  const response = await fetch(source.url, {
    headers: RSS_FETCH_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${source.id}: ${response.status} ${response.statusText}`,
    );
  }

  const xml = await response.text();
  if (!looksLikeFeedXml(xml)) {
    const preview = xml.trimStart().slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      `Feed ${source.id} did not return XML (got: ${preview || "(empty)"})`,
    );
  }

  return xml;
}

async function parseFeedXml(xml: string, sourceId: string) {
  try {
    return await parser.parseString(xml);
  } catch (firstError) {
    const repaired = repairRssXml(xml);
    if (repaired === xml) {
      throw firstError;
    }
    try {
      return await parser.parseString(repaired);
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`RSS XML parse failed for ${sourceId}: ${message}`, { cause: secondError });
    }
  }
}

export async function fetchRssSource(source: Source) {
  const xml = await fetchRssXml(source);
  return parseFeedXml(xml, source.id);
}
