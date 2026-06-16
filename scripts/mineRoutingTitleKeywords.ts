/**
 * Mine yes-only title tokens from broad-science routing candidates.
 * Usage: npx tsx scripts/mineRoutingTitleKeywords.ts [analysis-json-path]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

type CandidateRow = {
  reportDate: string;
  sourceId: string;
  id: string;
  title: string;
  verdict: "yes" | "no" | "not_sure";
};

type AnalysisFile = {
  papers: CandidateRow[];
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "both", "either", "neither",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "have", "has", "had", "having", "do", "does", "did", "doing",
  "will", "would", "could", "should", "may", "might", "must", "shall", "can",
  "of", "in", "to", "for", "with", "on", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "under", "over", "via",
  "within", "without", "against", "among", "across", "about", "around", "upon", "toward",
  "towards", "than", "then", "that", "this", "these", "those", "it", "its", "they",
  "them", "their", "theirs", "we", "our", "ours", "you", "your", "yours", "he", "she",
  "his", "her", "him", "who", "whom", "whose", "which", "what", "when", "where", "why",
  "how", "all", "any", "each", "few", "more", "most", "other", "some", "such", "no",
  "not", "only", "own", "same", "too", "very", "just", "also", "even", "still", "already",
  "here", "there", "now", "out", "up", "down", "off", "again", "further", "once",
  "if", "because", "while", "although", "though", "whether", "however", "therefore",
  "using", "use", "used", "uses", "based", "show", "shows", "showed", "shown",
  "reveal", "reveals", "revealed", "demonstrate", "demonstrates", "demonstrated",
  "provide", "provides", "provided", "identify", "identifies", "identified",
  "develop", "develops", "developed", "investigate", "investigates", "investigated",
  "study", "studies", "studied", "find", "finds", "found", "report", "reports", "reported",
  "new", "novel", "one", "two", "three", "first", "second", "third", "high", "low",
  "large", "small", "key", "major", "critical", "important", "potential", "possible",
  "approach", "approaches", "method", "methods", "model", "models", "system", "systems",
  "data", "analysis", "analyses", "role", "roles", "effect", "effects", "impact", "impacts",
  "via", "per", "non", "well", "like", "including", "include", "includes", "included",
  "across", "between", "among", "through", "under", "over", "into", "from", "than",
]);

/** Keep short tokens only if they look like biomedical abbreviations. */
const ALLOW_SHORT = new Set(["mr", "ai", "ls", "qc", "iv", "vi", "vii", "viii"]);

function normalizeStem(token: string): string {
  let t = token.toLowerCase();
  if (t.length <= 2) return t;

  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith("oes") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ves") && t.length > 4) return `${t.slice(0, -3)}f`;
  if (t.endsWith("ses") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ches") || t.endsWith("shes") || t.endsWith("xes") || t.endsWith("zes")) {
    return t.slice(0, -2);
  }
  if (t.endsWith("es") && t.length > 3) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) return t.slice(0, -1);
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("edly") && t.length > 6) return t.slice(0, -4);
  if (t.endsWith("ly") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("en") && t.length > 4) return t.slice(0, -2);
  return t;
}

function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9+-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => {
      if (ALLOW_SHORT.has(t)) return true;
      if (t.length < 3) return false;
      if (/^\d+$/.test(t)) return false;
      return !STOP_WORDS.has(t);
    });
}

type TokenStats = {
  stem: string;
  surfaceForms: Set<string>;
  docFreq: number;
  totalFreq: number;
  exampleTitles: string[];
};

function buildTokenStats(titles: string[]): Map<string, TokenStats> {
  const byStem = new Map<string, TokenStats>();

  for (const title of titles) {
    const seenInDoc = new Set<string>();
    for (const token of tokenizeTitle(title)) {
      const stem = normalizeStem(token);
      let stats = byStem.get(stem);
      if (!stats) {
        stats = { stem, surfaceForms: new Set(), docFreq: 0, totalFreq: 0, exampleTitles: [] };
        byStem.set(stem, stats);
      }
      stats.surfaceForms.add(token);
      stats.totalFreq += 1;
      if (!seenInDoc.has(stem)) {
        stats.docFreq += 1;
        seenInDoc.add(stem);
        if (stats.exampleTitles.length < 3) {
          stats.exampleTitles.push(title);
        }
      }
    }
  }

  return byStem;
}

async function main() {
  const inputPath =
    process.argv[2] ??
    join(process.cwd(), "data/analysis/broad-science-routing-2026-06-04_10.json");
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as AnalysisFile;

  const yesTitles = raw.papers
    .filter((p) => p.verdict === "yes" || p.verdict === "not_sure")
    .map((p) => p.title);
  const noTitles = raw.papers.filter((p) => p.verdict === "no").map((p) => p.title);

  const yesStats = buildTokenStats(yesTitles);
  const noStats = buildTokenStats(noTitles);
  const noStems = new Set(noStats.keys());

  const yesOnly = [...yesStats.values()]
    .filter((s) => !noStems.has(s.stem))
    .sort((a, b) => b.docFreq - a.docFreq || b.totalFreq - a.totalFreq);

  const shared = [...yesStats.values()]
    .filter((s) => noStems.has(s.stem))
    .map((s) => ({
      stem: s.stem,
      yesDocFreq: s.docFreq,
      noDocFreq: noStats.get(s.stem)!.docFreq,
      yesTotalFreq: s.totalFreq,
      noTotalFreq: noStats.get(s.stem)!.totalFreq,
      surfaceForms: [...new Set([...s.surfaceForms, ...noStats.get(s.stem)!.surfaceForms])].sort(),
    }))
    .sort((a, b) => b.yesDocFreq + b.noDocFreq - (a.yesDocFreq + a.noDocFreq));

  const yesOnlySerializable = yesOnly.map((s) => ({
    stem: s.stem,
    surfaceForms: [...s.surfaceForms].sort(),
    yesDocFreq: s.docFreq,
    yesTotalFreq: s.totalFreq,
    yesDocRate: s.docFreq / yesTitles.length,
    exampleTitles: s.exampleTitles,
  }));

  const highSignal = yesOnlySerializable.filter(
    (s) => s.yesDocFreq >= 2 || (s.yesDocFreq === 1 && s.stem.length >= 6),
  );

  const out = {
    source: inputPath,
    counts: { yes: yesTitles.length, no: noTitles.length, total: raw.papers.length },
    method: {
      tokenize: "lowercase, strip punctuation, remove stop words, min length 3",
      stem: "light suffix normalization for yes/no overlap removal",
      yesOnlyRule: "stem appears in yes titles and never in no titles (after normalization)",
    },
    yesOnlyTokenCount: yesOnlySerializable.length,
    yesOnly: yesOnlySerializable,
    highSignalYesOnly: highSignal,
    sharedTokenCount: shared.length,
    sharedTop30: shared.slice(0, 30),
  };

  const outPath = join(process.cwd(), "data/analysis/routing-title-keyword-mining.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    counts: out.counts,
    yesOnlyTokenCount: out.yesOnlyTokenCount,
    highSignalCount: highSignal.length,
    topYesOnly: yesOnlySerializable.slice(0, 40).map((s) => ({
      stem: s.stem,
      forms: s.surfaceForms,
      docs: s.yesDocFreq,
      rate: `${(s.yesDocRate * 100).toFixed(1)}%`,
    })),
    outputPath: outPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
