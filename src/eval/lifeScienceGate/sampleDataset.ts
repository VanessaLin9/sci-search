import { HARD_TAGS } from "./constants.js";
import { observationsFromRows, type HistoricalPaperRow } from "./historicalPool.js";
import type { HardTag, LifeScienceGateCase, SampleGroup } from "./types.js";

const NEWS_TITLE =
  /^(editorial(\s+note)?|author correction|publisher correction|corrigendum|erratum|obituary|reply to)\b/i;
const NEWS_ANYWHERE =
  /\b(obituary|career column|career advice|news & views|news feature|world view|books & arts|nature podcast)\b/i;
const BIO_HINT =
  /\b(cell|gene|protein|cancer|tumor|neur|immuno|virus|viral|bacteria|dna|rna|mouse|mice|brain|stem|crispr|genome|tissue|embryo|blood|heart|liver|plant|ecolog|evolution|clinical|patient|disease|pathogen|antibod|receptor|mitochond|peptide|kinase|chromosom|synapse|microbiome|vaccine|therapy|biolog|medical|cardio|hepat|renal|lung|immune)\b/i;
const PHYS_HINT =
  /\b(quantum|superconduct|photon|galaxy|planet|climate|graphene|perovskite|transistor|alloy|tectonic|black hole|exoplanet|neutrino|topological|photonic|metamaterial|catalysis|electrochem|semiconductor|cosmol|astronom)\b/i;
const VAGUE_SHORT = /^[A-Za-z0-9 ,:;'’"()\-]{1,60}$/;

export type CandidateGroup = {
  groupId: string;
  primary: HistoricalPaperRow;
  rows: HistoricalPaperRow[];
  hardTags: HardTag[];
};

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

export function detectHardTags(group: { primary: HistoricalPaperRow; rows: HistoricalPaperRow[] }): HardTag[] {
  const tags = new Set<HardTag>();
  const title = group.primary.title;
  const wordCount = title.trim().split(/\s+/).filter(Boolean).length;
  if (NEWS_TITLE.test(title) || NEWS_ANYWHERE.test(title) || NEWS_ANYWHERE.test(group.primary.articleType ?? "")) {
    tags.add("news_commentary");
  }
  if (wordCount <= 5 && !BIO_HINT.test(title) && !PHYS_HINT.test(title) && VAGUE_SHORT.test(title)) {
    tags.add("vague_title");
  }
  if (BIO_HINT.test(title) && PHYS_HINT.test(title)) {
    tags.add("interdisciplinary");
  }
  if (group.rows.some((row) => row.method === "routing-keyword-fallback")) {
    tags.add("keyword_fallback");
  }
  const verdicts = new Set(group.rows.map((row) => row.verdict).filter(Boolean));
  if (verdicts.size > 1) {
    tags.add("historical_disagreement");
  }
  return HARD_TAGS.filter((tag) => tags.has(tag));
}

export function buildCandidateGroups(rows: HistoricalPaperRow[]): CandidateGroup[] {
  const byGroup = new Map<string, HistoricalPaperRow[]>();
  for (const row of rows) {
    const groupId = `doi:${row.doi.toLowerCase()}`;
    const list = byGroup.get(groupId) ?? [];
    list.push(row);
    byGroup.set(groupId, list);
  }

  return [...byGroup.entries()].map(([groupId, groupRows]) => {
    const ordered = [...groupRows].sort((left, right) => left.reportDate.localeCompare(right.reportDate));
    const primary =
      ordered.find((row) => row.method === "llm") ??
      ordered.find((row) => row.origin === "working-tree") ??
      ordered[0];
    return {
      groupId,
      primary,
      rows: ordered,
      hardTags: detectHardTags({ primary, rows: ordered }),
    };
  });
}

function take<T>(items: T[], count: number): { taken: T[]; rest: T[] } {
  return { taken: items.slice(0, count), rest: items.slice(count) };
}

export const DEFAULT_QUOTAS = {
  generalBySource: {
    science: 12,
    nature: 20,
    "nature-communications": 16,
    "science-advances": 22,
  },
  hard: {
    news_commentary: 8,
    vague_title: 6,
    interdisciplinary: 8,
    keyword_fallback: 5,
    historical_disagreement: 3,
  },
} as const;

export function sampleCandidateGroups(
  groups: CandidateGroup[],
  options?: { seed?: number; quotas?: typeof DEFAULT_QUOTAS },
): { selected: Array<CandidateGroup & { sampleGroup: SampleGroup }>; notes: string[] } {
  const quotas = options?.quotas ?? DEFAULT_QUOTAS;
  const random = mulberry32(options?.seed ?? 20261003);
  const notes: string[] = [];
  const selectedIds = new Set<string>();
  const selected: Array<CandidateGroup & { sampleGroup: SampleGroup }> = [];

  const unused = () => groups.filter((group) => !selectedIds.has(group.groupId));

  for (const [tag, quota] of Object.entries(quotas.hard) as Array<[HardTag, number]>) {
    const pool = shuffle(
      unused().filter((group) => group.hardTags.includes(tag)),
      random,
    );
    const { taken } = take(pool, quota);
    if (taken.length < quota) {
      notes.push(`hard tag ${tag}: wanted ${quota}, got ${taken.length}`);
    }
    for (const group of taken) {
      selectedIds.add(group.groupId);
      selected.push({ ...group, sampleGroup: "hard" });
    }
  }

  for (const [sourceId, quota] of Object.entries(quotas.generalBySource)) {
    const pool = shuffle(
      unused().filter((group) => group.primary.sourceId === sourceId),
      random,
    );
    const { taken } = take(pool, quota);
    if (taken.length < quota) {
      notes.push(`general source ${sourceId}: wanted ${quota}, got ${taken.length}`);
    }
    for (const group of taken) {
      selectedIds.add(group.groupId);
      selected.push({ ...group, sampleGroup: "general" });
    }
  }

  const targetSize =
    Object.values(quotas.generalBySource).reduce((sum, count) => sum + count, 0) +
    Object.values(quotas.hard).reduce((sum, count) => sum + count, 0);
  const remaining = targetSize - selected.length;
  if (remaining > 0) {
    const pool = shuffle(unused(), random);
    const { taken } = take(pool, remaining);
    notes.push(`topped up ${taken.length} general cases after hard-tag shortfalls`);
    for (const group of taken) {
      selectedIds.add(group.groupId);
      selected.push({ ...group, sampleGroup: "general" });
    }
  }

  return { selected, notes };
}

export function assignSplits<T extends { groupId: string; sampleGroup: SampleGroup; primary: HistoricalPaperRow }>(
  selected: T[],
  options?: { seed?: number; devFraction?: number },
): Array<T & { split: "dev" | "eval" }> {
  const random = mulberry32((options?.seed ?? 20261003) + 17);
  const devFraction = options?.devFraction ?? 0.6;
  const result: Array<T & { split: "dev" | "eval" }> = [];
  const buckets = new Map<string, T[]>();

  for (const item of selected) {
    const key = `${item.sampleGroup}::${item.primary.sourceId}`;
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  for (const list of buckets.values()) {
    const shuffled = shuffle(list, random);
    const devCount = Math.round(shuffled.length * devFraction);
    shuffled.forEach((item, index) => {
      result.push({ ...item, split: index < devCount ? "dev" : "eval" });
    });
  }

  return result;
}

export function candidateToPartialCase(
  item: CandidateGroup & { sampleGroup: SampleGroup; split: "dev" | "eval" },
  caseId: string,
): Pick<
  LifeScienceGateCase,
  "caseId" | "groupId" | "input" | "provenance" | "sampleGroup" | "hardTags" | "split" | "historical"
> {
  const primary = item.primary;
  return {
    caseId,
    groupId: item.groupId,
    input: {
      id: primary.id,
      title: primary.title,
      journal: primary.journal,
      source_id: primary.sourceId,
    },
    provenance: {
      kind: primary.origin === "working-tree" ? "historical_processed" : "historical_processed",
      reportDate: primary.reportDate,
      path: primary.path,
      gitCommit: primary.gitCommit,
      recoverableExcluded: item.rows.some((row) => !row.included && row.recoverableExcluded),
      notes: primary.origin === "git-history" ? "recovered from git history after daily retention prune" : undefined,
    },
    sampleGroup: item.sampleGroup,
    hardTags: item.hardTags,
    split: item.split,
    historical: {
      referenceOnly: true,
      observations: observationsFromRows(item.rows),
    },
  };
}
