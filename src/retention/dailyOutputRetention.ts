import type { Dirent } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { format, isValid, parseISO, subDays } from "date-fns";

const DATE_LABEL_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type RetentionPrunePlan = {
  baseDate: string;
  days: number;
  oldestKeepDate: string;
  processedDatesToRemove: string[];
  archiveDatesToRemove: string[];
};

export function isRetentionDateLabel(value: string): boolean {
  if (!DATE_LABEL_PATTERN.test(value)) {
    return false;
  }

  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}

export function computeOldestKeepDate(baseDate: string, days: number): string {
  if (!isRetentionDateLabel(baseDate)) {
    throw new Error(`Invalid base date: ${baseDate}`);
  }
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Retention days must be a positive integer, got ${days}`);
  }

  return format(subDays(parseISO(baseDate), days - 1), "yyyy-MM-dd");
}

export function shouldPruneRetentionDate(date: string, baseDate: string, days: number): boolean {
  if (!isRetentionDateLabel(date)) {
    return false;
  }
  if (date > baseDate) {
    return false;
  }

  return date < computeOldestKeepDate(baseDate, days);
}

function collectDatesToRemove(dateLabels: string[], baseDate: string, days: number): string[] {
  return dateLabels
    .filter((date) => shouldPruneRetentionDate(date, baseDate, days))
    .sort();
}

export function planRetentionPruneFromEntries(options: {
  baseDate: string;
  days: number;
  processedDateLabels: string[];
  archiveDateLabels: string[];
}): RetentionPrunePlan {
  const oldestKeepDate = computeOldestKeepDate(options.baseDate, options.days);

  return {
    baseDate: options.baseDate,
    days: options.days,
    oldestKeepDate,
    processedDatesToRemove: collectDatesToRemove(
      options.processedDateLabels,
      options.baseDate,
      options.days,
    ),
    archiveDatesToRemove: collectDatesToRemove(
      options.archiveDateLabels,
      options.baseDate,
      options.days,
    ),
  };
}

async function listDirectoryEntries(root: string): Promise<Dirent[]> {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listProcessedDateLabels(root: string): Promise<string[]> {
  const entries = await listDirectoryEntries(root);
  return entries
    .filter((entry) => entry.isDirectory() && isRetentionDateLabel(entry.name))
    .map((entry) => entry.name);
}

async function listArchiveDateLabels(root: string): Promise<string[]> {
  const entries = await listDirectoryEntries(root);
  return entries
    .map((entry) => {
      if (!entry.isFile()) {
        return null;
      }
      return archiveDateLabelFromFileName(entry.name);
    })
    .filter((entry): entry is string => entry !== null);
}

function archiveDateLabelFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(".html")) {
    return null;
  }

  const dateLabel = fileName.slice(0, -".html".length);
  return isRetentionDateLabel(dateLabel) ? dateLabel : null;
}

export async function scanAndPlanRetentionPrune(options: {
  baseDate: string;
  days: number;
  processedRoot?: string;
  archiveRoot?: string;
}): Promise<RetentionPrunePlan> {
  const processedRoot = options.processedRoot ?? join("data", "processed");
  const archiveRoot = options.archiveRoot ?? join("docs", "archive");

  const processedDateLabels = await listProcessedDateLabels(processedRoot);
  const archiveDateLabels = await listArchiveDateLabels(archiveRoot);

  return planRetentionPruneFromEntries({
    baseDate: options.baseDate,
    days: options.days,
    processedDateLabels,
    archiveDateLabels,
  });
}

export async function applyRetentionPrune(
  plan: RetentionPrunePlan,
  options?: {
    processedRoot?: string;
    archiveRoot?: string;
  },
): Promise<void> {
  const processedRoot = options?.processedRoot ?? join("data", "processed");
  const archiveRoot = options?.archiveRoot ?? join("docs", "archive");

  for (const date of plan.processedDatesToRemove) {
    await rm(join(processedRoot, date), { recursive: true, force: true });
  }

  for (const date of plan.archiveDatesToRemove) {
    await rm(join(archiveRoot, `${date}.html`), { force: true });
  }
}
