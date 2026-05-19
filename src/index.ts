import { loadSources, loadKeywords } from "./config.js";
import { todayInTaipei } from "./date.js";
import { fetchRssSource } from "./fetchRss.js";
import { normalizeRssItemToPaper } from "./normalize.js";
import { dedupePapers, matchKeywords } from "./filterPapers.js";

async function main() {
  const today = todayInTaipei();
  const sources = await loadSources();
  const keywords = await loadKeywords();

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
    const papers = feed.items
      .map((item) => normalizeRssItemToPaper(item, source))
      .filter((paper): paper is NonNullable<typeof paper> => paper !== null);
    const allKeywords = [...keywords.primary, ...keywords.biology];
    const papersWithKeywords = papers.map((paper) => {
      const searchableText = [paper.title, paper.abstract].filter(Boolean).join(" ");
      const matchedKeywords = matchKeywords(searchableText, allKeywords);

      return {
        ...paper,
        matchedKeywords,
      };
    });
    const dedupedPapers = dedupePapers(papersWithKeywords);

    console.log(`Feed: ${feed.title ?? source.name}`);
    console.log(`Items: ${feed.items.length}`);
    console.log(`Papers: ${dedupedPapers.length}`);
    console.log(dedupedPapers.slice(0, 3));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
