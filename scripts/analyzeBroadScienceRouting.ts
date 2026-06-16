/**
 * Analyze broad-science routing LLM gate from local papers.json (no live LLM).
 * Usage: npx tsx scripts/analyzeBroadScienceRouting.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadKeywords } from "../src/config.js";
import { matchKeywords } from "../src/domain/life-science/classifyKeywords.js";

const BROAD_SCIENCE_SOURCE_IDS = new Set([
  "nature",
  "science",
  "science-advances",
  "pnas",
  "nature-communications",
]);

const ABSTRACT_MIN_CHARS = 80;

type RoutingVerdict = "yes" | "no" | "not_sure";

type PaperRow = {
  id: string;
  title: string;
  journal?: string;
  abstract?: string;
  sourceId: string;
  lifeScienceRouting?: { verdict: RoutingVerdict; method: "llm" | "scope-default" };
  digestLine?: string;
  featured?: boolean;
  matchedKeywords?: string[];
};

type ExcludedRow = {
  paper: PaperRow;
  reason: string;
  verdict?: RoutingVerdict;
};

type ProcessedDay = {
  reportDate: string;
  generatedAt?: string;
  routing?: {
    enabled: boolean;
    stats?: {
      llmClassified?: number;
      llmYes?: number;
      llmNotSure?: number;
      llmNo?: number;
    };
  };
  papers: PaperRow[];
  excludedPapers?: ExcludedRow[];
};

type CandidateRow = {
  reportDate: string;
  sourceId: string;
  id: string;
  title: string;
  abstract: string;
  abstractLen: number;
  abstractMissingOrShort: boolean;
  verdict: RoutingVerdict;
  routingIncluded: boolean;
  inFinalPapers: boolean;
  digestLine: string | null;
  primaryTitle: string[];
  biologyTitle: string[];
  primaryTitleAbstract: string[];
  biologyTitleAbstract: string[];
  keywordHitTitle: boolean;
  keywordHitTitleAbstract: boolean;
};

function parseArgs(): { from: string; to: string } {
  const args = process.argv.slice(2);
  let from = "2026-06-04";
  let to = "2026-06-10";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--from" && args[i + 1]) {
      from = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--to" && args[i + 1]) {
      to = args[i + 1]!;
      i += 1;
    }
  }
  return { from, to };
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function isBroadScienceSource(sourceId: string): boolean {
  return BROAD_SCIENCE_SOURCE_IDS.has(sourceId);
}

function collectCandidates(day: ProcessedDay, keywords: Awaited<ReturnType<typeof loadKeywords>>): CandidateRow[] {
  const rows: CandidateRow[] = [];
  const finalIds = new Set(day.papers.map((p) => p.id));

  for (const paper of day.papers) {
    if (!isBroadScienceSource(paper.sourceId)) continue;
    if (paper.lifeScienceRouting?.method !== "llm") continue;

    const abstract = paper.abstract?.trim() ?? "";
    const titleText = paper.title;
    const titleAbstractText = [paper.title, abstract].filter(Boolean).join(" ");

    rows.push({
      reportDate: day.reportDate,
      sourceId: paper.sourceId,
      id: paper.id,
      title: paper.title,
      abstract,
      abstractLen: abstract.length,
      abstractMissingOrShort: abstract.length < ABSTRACT_MIN_CHARS,
      verdict: paper.lifeScienceRouting.verdict,
      routingIncluded: true,
      inFinalPapers: finalIds.has(paper.id),
      digestLine: paper.digestLine ?? null,
      primaryTitle: matchKeywords(titleText, keywords.primary),
      biologyTitle: matchKeywords(titleText, keywords.biology),
      primaryTitleAbstract: matchKeywords(titleAbstractText, keywords.primary),
      biologyTitleAbstract: matchKeywords(titleAbstractText, keywords.biology),
      keywordHitTitle:
        matchKeywords(titleText, keywords.primary).length > 0 ||
        matchKeywords(titleText, keywords.biology).length > 0,
      keywordHitTitleAbstract:
        matchKeywords(titleAbstractText, keywords.primary).length > 0 ||
        matchKeywords(titleAbstractText, keywords.biology).length > 0,
    });
  }

  for (const excluded of day.excludedPapers ?? []) {
    const paper = excluded.paper;
    if (!isBroadScienceSource(paper.sourceId)) continue;
    if (excluded.reason !== "life-science-routing") continue;

    const abstract = paper.abstract?.trim() ?? "";
    const titleText = paper.title;
    const titleAbstractText = [paper.title, abstract].filter(Boolean).join(" ");

    rows.push({
      reportDate: day.reportDate,
      sourceId: paper.sourceId,
      id: paper.id,
      title: paper.title,
      abstract,
      abstractLen: abstract.length,
      abstractMissingOrShort: abstract.length < ABSTRACT_MIN_CHARS,
      verdict: excluded.verdict ?? "no",
      routingIncluded: false,
      inFinalPapers: false,
      digestLine: null,
      primaryTitle: matchKeywords(titleText, keywords.primary),
      biologyTitle: matchKeywords(titleText, keywords.biology),
      primaryTitleAbstract: matchKeywords(titleAbstractText, keywords.primary),
      biologyTitleAbstract: matchKeywords(titleAbstractText, keywords.biology),
      keywordHitTitle:
        matchKeywords(titleText, keywords.primary).length > 0 ||
        matchKeywords(titleText, keywords.biology).length > 0,
      keywordHitTitleAbstract:
        matchKeywords(titleAbstractText, keywords.primary).length > 0 ||
        matchKeywords(titleAbstractText, keywords.biology).length > 0,
    });
  }

  return rows;
}

function countVerdicts(rows: CandidateRow[]): Record<RoutingVerdict, number> {
  return rows.reduce(
    (acc, row) => {
      acc[row.verdict] += 1;
      return acc;
    },
    { yes: 0, not_sure: 0, no: 0 } as Record<RoutingVerdict, number>,
  );
}

async function main() {
  const { from, to } = parseArgs();
  const keywords = await loadKeywords();
  const processedDir = join(process.cwd(), "data/processed");
  const dirs = (await readdir(processedDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

  const allCandidates: CandidateRow[] = [];
  const dailySummaries: Array<{
    date: string;
    candidates: number;
    verdicts: Record<RoutingVerdict, number>;
    statsFromFile: ProcessedDay["routing"];
    missingFile: boolean;
  }> = [];

  for (const date of dirs) {
    if (!inRange(date, from, to)) continue;
    const path = join(processedDir, date, "papers.json");
    let day: ProcessedDay;
    try {
      day = JSON.parse(await readFile(path, "utf8")) as ProcessedDay;
    } catch {
      dailySummaries.push({
        date,
        candidates: 0,
        verdicts: { yes: 0, not_sure: 0, no: 0 },
        statsFromFile: undefined,
        missingFile: true,
      });
      continue;
    }

    const candidates = collectCandidates(day, keywords);
    allCandidates.push(...candidates);
    dailySummaries.push({
      date,
      candidates: candidates.length,
      verdicts: countVerdicts(candidates),
      statsFromFile: day.routing,
      missingFile: false,
    });
  }

  const bySource = new Map<string, CandidateRow[]>();
  for (const row of allCandidates) {
    const list = bySource.get(row.sourceId) ?? [];
    list.push(row);
    bySource.set(row.sourceId, list);
  }

  const yesNotSureNoKeywordTitle = allCandidates.filter(
    (r) => (r.verdict === "yes" || r.verdict === "not_sure") && !r.keywordHitTitle,
  );
  const noWithKeywordTitle = allCandidates.filter((r) => r.verdict === "no" && r.keywordHitTitle);
  const shortAbstract = allCandidates.filter((r) => r.abstractMissingOrShort);

  // Hypothetical keyword-only routing fallback (title-only biology keywords → yes, else no)
  const biologyTitleFallback = allCandidates.map((r) => ({
    ...r,
    wouldInclude: r.biologyTitle.length > 0 || r.primaryTitle.length > 0,
  }));
  const biologyOnlyFallback = allCandidates.map((r) => ({
    ...r,
    wouldInclude: r.biologyTitle.length > 0,
  }));
  const lifeScienceTitleHeuristic = allCandidates.map((r) => {
    const t = r.title.toLowerCase();
    const lsHints = [
      "cell",
      "gene",
      "protein",
      "brain",
      "cancer",
      "immune",
      "virus",
      "bacteria",
      "organism",
      "species",
      "neuron",
      "tissue",
      "RNA",
      "DNA",
      "microbi",
      "patient",
      "clinical",
      "disease",
      "therapy",
      "drug",
    ];
    return { ...r, wouldInclude: lsHints.some((h) => t.includes(h.toLowerCase())) };
  });

  function fallbackMetrics(
    label: string,
    rows: Array<CandidateRow & { wouldInclude: boolean }>,
  ) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const r of rows) {
      const actualInclude = r.verdict === "yes" || r.verdict === "not_sure";
      if (r.wouldInclude && actualInclude) tp += 1;
      else if (r.wouldInclude && !actualInclude) fp += 1;
      else if (!r.wouldInclude && actualInclude) fn += 1;
      else tn += 1;
    }
    return { label, tp, fp, fn, tn, precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1) };
  }

  const fallbackSims = [
    fallbackMetrics("primary|biology title match → include", biologyTitleFallback),
    fallbackMetrics("biology title only → include", biologyOnlyFallback),
    fallbackMetrics("life-science title heuristic → include", lifeScienceTitleHeuristic),
  ];

  const out = {
    range: { from, to },
    note: "Broad-science sources: nature, science, science-advances, pnas, nature-communications. Routing LLM uses title only; keyword columns show title-only vs title+abstract.",
    dailySummaries,
    bySource: Object.fromEntries(
      [...bySource.entries()].map(([sourceId, rows]) => [
        sourceId,
        { count: rows.length, verdicts: countVerdicts(rows) },
      ]),
    ),
    totals: {
      candidates: allCandidates.length,
      verdicts: countVerdicts(allCandidates),
    },
    specialLists: {
      yesNotSureNoKeywordTitle: yesNotSureNoKeywordTitle.map((r) => ({
        date: r.reportDate,
        sourceId: r.sourceId,
        id: r.id,
        title: r.title,
        verdict: r.verdict,
        primaryTitleAbstract: r.primaryTitleAbstract,
        biologyTitleAbstract: r.biologyTitleAbstract,
      })),
      noWithKeywordTitle: noWithKeywordTitle.map((r) => ({
        date: r.reportDate,
        sourceId: r.sourceId,
        id: r.id,
        title: r.title,
        primaryTitle: r.primaryTitle,
        biologyTitle: r.biologyTitle,
      })),
      abstractMissingOrShort: shortAbstract.map((r) => ({
        date: r.reportDate,
        sourceId: r.sourceId,
        id: r.id,
        title: r.title,
        abstractLen: r.abstractLen,
        verdict: r.verdict,
        routingIncluded: r.routingIncluded,
      })),
    },
    fallbackSimulations: fallbackSims,
    papers: allCandidates,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
