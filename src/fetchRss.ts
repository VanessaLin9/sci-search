import Parser from "rss-parser";
import type { Source } from "./types.js";

const parser = new Parser();

export async function fetchRssSource(source: Source) {
  return parser.parseURL(source.url);
}
