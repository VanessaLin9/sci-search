import { loadSources, loadKeywords } from "./config.js";
import { todayInTaipei } from "./date.js";
import { fetchRssSource } from "./fetchRss.js";
import { normalizeRssItemToPaper } from "./normalize.js";
import {
  classifyPaperSection,
  countPapersBySection,
  dedupePapers,
  filterPapersByDate,
  getPaperSections,
  matchKeywords,
} from "./filterPapers.js";

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
    const dedupedPapers = dedupePapers(papers);
    const papersOnTargetDate = filterPapersByDate(dedupedPapers, today);
    const classifiedPapers = papersOnTargetDate.map((paper) => {
      const searchableText = [paper.title, paper.abstract].filter(Boolean).join(" ");
      const primaryMatches = matchKeywords(searchableText, keywords.primary);
      const biologyMatches = matchKeywords(searchableText, keywords.biology);
      const matchedKeywords = [...primaryMatches, ...biologyMatches];
      const section = classifyPaperSection(primaryMatches, biologyMatches);

      return {
        ...paper,
        matchedKeywords,
        section,
      };
    });
    const sectionCounts = countPapersBySection(classifiedPapers);

    console.log(`Feed: ${feed.title ?? source.name}`);
    console.log(`RSS items: ${feed.items.length}`);
    console.log(`Normalized papers: ${papers.length}`);
    console.log(`Deduped papers: ${dedupedPapers.length}`);
    console.log(`Papers on ${today}: ${papersOnTargetDate.length}`);
    console.log(
      `Section counts: ${getPaperSections()
        .map((section) => `${section}: ${sectionCounts[section]}`)
        .join(", ")}`,
    );
    console.log(
      classifiedPapers.slice(0, 3).map((paper) => ({
        title: paper.title,
        matchedKeywords: paper.matchedKeywords,
        section: paper.section,
      })),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
