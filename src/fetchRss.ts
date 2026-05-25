import Parser from "rss-parser";
import { looksLikeFeedXml, repairRssXml } from "./sanitizeRssXml.js";
import type { Source } from "./types.js";

const parser = new Parser({
  customFields: {
    item: [
      ["dc:source", "source"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

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
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "paper-digest/0.1 (+https://github.com/)",
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
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

  return parseFeedXml(xml, source.id);
}
