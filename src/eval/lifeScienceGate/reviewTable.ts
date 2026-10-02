import type { LifeScienceGateCase, LifeScienceGateDataset, RoutingVerdict } from "./types.js";

const REVIEW_COLUMNS = [
  "caseId",
  "split",
  "sampleGroup",
  "hardTags",
  "source_id",
  "journal",
  "title",
  "draftVerdict",
  "draftReason",
  "goldVerdict",
  "goldReason",
  "annotationStatus",
  "reviewer",
  "reviewedAt",
  "notes",
] as const;

export type ReviewRow = {
  caseId: string;
  split: string;
  sampleGroup: string;
  hardTags: string;
  source_id: string;
  journal: string;
  title: string;
  draftVerdict: string;
  draftReason: string;
  goldVerdict: string;
  goldReason: string;
  annotationStatus: string;
  reviewer: string;
  reviewedAt: string;
  notes: string;
};

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function encodeCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n") + "\n";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.length > 0));
}

export function datasetToReviewRows(dataset: LifeScienceGateDataset): ReviewRow[] {
  return dataset.cases.map((gateCase) => ({
    caseId: gateCase.caseId,
    split: gateCase.split,
    sampleGroup: gateCase.sampleGroup,
    hardTags: gateCase.hardTags.join("|"),
    source_id: gateCase.input.source_id,
    journal: gateCase.input.journal,
    title: gateCase.input.title,
    draftVerdict: gateCase.draftVerdict,
    draftReason: gateCase.draftReason,
    goldVerdict: gateCase.goldVerdict ?? "",
    goldReason: gateCase.goldReason ?? "",
    annotationStatus: gateCase.annotationStatus,
    reviewer: gateCase.reviewer ?? "",
    reviewedAt: gateCase.reviewedAt ?? "",
    notes: "",
  }));
}

export function exportReviewCsv(dataset: LifeScienceGateDataset): string {
  const rows = datasetToReviewRows(dataset);
  return encodeCsv([
    [...REVIEW_COLUMNS],
    ...rows.map((row) => REVIEW_COLUMNS.map((column) => row[column])),
  ]);
}

export function parseReviewCsv(text: string): ReviewRow[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header || header.join(",") !== REVIEW_COLUMNS.join(",")) {
    throw new Error("Review CSV header does not match the expected columns");
  }
  return rows.slice(1).map((values) => {
    const row = {} as ReviewRow;
    for (const [index, column] of REVIEW_COLUMNS.entries()) {
      row[column] = values[index] ?? "";
    }
    return row;
  });
}

function parseOptionalVerdict(value: string): RoutingVerdict | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "yes" || trimmed === "no" || trimmed === "not_sure") return trimmed;
  throw new Error(`Invalid goldVerdict: ${value}`);
}

export function applyReviewRows(
  dataset: LifeScienceGateDataset,
  rows: ReviewRow[],
): LifeScienceGateDataset {
  const byId = new Map(dataset.cases.map((gateCase) => [gateCase.caseId, gateCase]));
  const seen = new Set<string>();
  const cases: LifeScienceGateCase[] = dataset.cases.map((gateCase) => ({ ...gateCase }));

  for (const row of rows) {
    if (seen.has(row.caseId)) {
      throw new Error(`Duplicate review row for ${row.caseId}`);
    }
    seen.add(row.caseId);
    const current = byId.get(row.caseId);
    if (!current) {
      throw new Error(`Review row caseId ${row.caseId} is not in the dataset`);
    }
    const index = cases.findIndex((item) => item.caseId === row.caseId);
    const goldVerdict = parseOptionalVerdict(row.goldVerdict);
    const annotationStatus = row.annotationStatus.trim() || current.annotationStatus;
    if (
      annotationStatus !== "pending_review" &&
      annotationStatus !== "reviewed" &&
      annotationStatus !== "disputed"
    ) {
      throw new Error(`Invalid annotationStatus for ${row.caseId}`);
    }
    cases[index] = {
      ...current,
      goldVerdict,
      goldReason: row.goldReason.trim() ? row.goldReason : null,
      annotationStatus,
      reviewer: row.reviewer.trim() ? row.reviewer : null,
      reviewedAt: row.reviewedAt.trim() ? row.reviewedAt : null,
    };
  }

  return { ...dataset, cases };
}
