import { loadSources, loadKeywords } from "./config.js";
import { defaultReportDateInTaipei, todayInTaipei } from "./date.js";
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
import type { Paper } from "./types.js";
import { writeJsonFile } from "./writeJson.js";

function printNormalizedPapers(sourceId: string, papers: Paper[]) {
  console.log(`Normalized papers detail (${sourceId}):`);
  console.table(
    papers.map((paper, index) => ({
      index: index + 1,
      id: paper.id,
      title: paper.title,
      publishedDate: paper.publishedDate,
      url: paper.url,
      doi: paper.doi ?? "(missing)",
      abstract: paper.abstract ? `${paper.abstract.slice(0, 120)}...` : "(missing)",
      sourceId: paper.sourceId,
    })),
  );
}

async function main() {
  const today = todayInTaipei();
  const reportDate = defaultReportDateInTaipei();
  const sources = await loadSources();
  const keywords = await loadKeywords();
  const allClassifiedPapers: Paper[] = [];

  console.log(`Paper Digest scaffold`);
  console.log(`Date: ${today} (Asia/Taipei)`);
  console.log(`Report date: ${reportDate} (Asia/Taipei)`);
  console.log(`Sources: ${sources.length}`);

  const rssSourceIds = ["nature-methods", "cell"];

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
    const papersOnReportDate = filterPapersByDate(dedupedPapers, reportDate);
    const classifiedPapers = papersOnReportDate.map((paper) => {
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
    allClassifiedPapers.push(...classifiedPapers);
    const sectionCounts = countPapersBySection(classifiedPapers);

    console.log(`Feed: ${feed.title ?? source.name}`);
    console.log(`RSS items: ${feed.items.length}`);
    console.log(`Normalized papers: ${papers.length}`);
    printNormalizedPapers(source.id, papers);
    console.log(`Deduped papers: ${dedupedPapers.length}`);
    console.log(`Papers on report date: ${papersOnReportDate.length}`);
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

  const outputPath = `data/processed/${reportDate}/papers.json`;
  await writeJsonFile(outputPath, {
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: allClassifiedPapers,
  });
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
