import { loadSources } from "./config.js";
import { todayInTaipei } from "./date.js";
import { fetchRssSource } from "./fetchRss.js";

async function main() {
  const today = todayInTaipei();
  const sources = await loadSources();

  console.log(`Paper Digest scaffold`);
  console.log(`Date: ${today} (Asia/Taipei)`);
  console.log(`Sources: ${sources.length}`);

  const rssSourceIds = ["nature-methods"];

  for (const id of rssSourceIds) {
    const source = sources.find((source) => source.id === id);

    if (!source) {
      throw new Error(`Source ${id} not found`);
    }

    if (source.kind !== "rss") {
      throw new Error(`Source ${id} is not an RSS source`);
    }

    const feed = await fetchRssSource(source);

    console.log(`Feed: ${feed.title ?? source.name}`);
    console.log(`Items: ${feed.items.length}`);
    console.log(
      feed.items.slice(0, 3).map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        isoDate: item.isoDate,
      })),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
