import { loadKeywords, loadSources } from "./config.js";
import { todayInTaipei } from "./date.js";

async function main() {
  const today = todayInTaipei();
  const sources = await loadSources();
  const keywords = await loadKeywords();

  console.log(`Paper Digest scaffold`);
  console.log(`Date: ${today} (Asia/Taipei)`);
  console.log(`Sources: ${sources.length}`);

  for (const source of sources) {
    console.log(`- [${source.kind}] ${source.name}: ${source.url}`);
  }

  console.log(
    `Keywords: ${keywords.primary.length} primary + ${keywords.biology.length} biology`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
