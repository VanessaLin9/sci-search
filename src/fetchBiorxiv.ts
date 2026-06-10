import { z } from "zod";
import type { BiorxivRecord } from "./normalizers/biorxiv.js";

const numericField = z
  .union([z.number(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return 0;
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

const biorxivMessageSchema = z.object({
  status: z.string(),
  cursor: numericField,
  count: numericField,
  total: numericField,
});

const biorxivResponseSchema = z.object({
  messages: z.array(biorxivMessageSchema),
  collection: z.array(z.record(z.unknown())),
});

export type BiorxivCategoryFetchStat = {
  category: string;
  recordCount: number;
  status: "ok" | "empty" | "skipped";
  error?: string;
};

export type BiorxivFetchResult = {
  records: BiorxivRecord[];
  categoryCount: number;
  fetchedCount: number;
  categoryStats: BiorxivCategoryFetchStat[];
};

export const BIORXIV_FETCH_HEADERS = {
  "User-Agent": "paper-digest/0.1 (+https://github.com/)",
  Accept: "application/json",
} as const;

const PAGE_SIZE = 100;

function buildCategoryUrl(
  baseUrl: string,
  reportDate: string,
  category: string,
  cursor: number,
): string {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const url = new URL(`${trimmedBase}/${reportDate}/${reportDate}/${cursor}/json`);
  url.searchParams.set("category", category);
  return url.toString();
}

export async function fetchBiorxivCategoryPage(
  baseUrl: string,
  reportDate: string,
  category: string,
  cursor: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ records: BiorxivRecord[]; nextCursor: number | null }> {
  const url = buildCategoryUrl(baseUrl, reportDate, category, cursor);
  const response = await fetchFn(url, {
    headers: BIORXIV_FETCH_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch bioRxiv ${category}: ${response.status} ${response.statusText}`,
    );
  }

  const parsed = biorxivResponseSchema.parse(await response.json());
  const message = parsed.messages[0];
  if (!message) {
    throw new Error(`bioRxiv API error for ${category}: missing status message`);
  }
  if (message.status === "no posts found") {
    return { records: [], nextCursor: null };
  }
  if (message.status !== "ok") {
    throw new Error(`bioRxiv API error for ${category}: ${message.status}`);
  }

  const records = parsed.collection as BiorxivRecord[];
  const total = message.total;
  const nextCursor = message.cursor + message.count;
  if (message.count === 0 || records.length === 0 || nextCursor >= total) {
    return { records, nextCursor: null };
  }

  return { records, nextCursor };
}

export async function fetchBiorxivCategoryRecords(
  baseUrl: string,
  reportDate: string,
  category: string,
  fetchFn: typeof fetch = fetch,
): Promise<BiorxivRecord[]> {
  const records: BiorxivRecord[] = [];
  let cursor = 0;

  while (true) {
    const page = await fetchBiorxivCategoryPage(baseUrl, reportDate, category, cursor, fetchFn);
    records.push(...page.records);
    if (page.nextCursor === null) {
      break;
    }
    cursor = page.nextCursor;
    if (cursor > 10_000) {
      throw new Error(`bioRxiv pagination exceeded safety limit for ${category}`);
    }
  }

  return records;
}

export async function fetchBiorxivRecords(options: {
  baseUrl: string;
  reportDate: string;
  categories: readonly string[];
  fetchFn?: typeof fetch;
}): Promise<BiorxivFetchResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const records: BiorxivRecord[] = [];
  const categoryStats: BiorxivCategoryFetchStat[] = [];
  let fetchedCount = 0;

  for (const category of options.categories) {
    try {
      const categoryRecords = await fetchBiorxivCategoryRecords(
        options.baseUrl,
        options.reportDate,
        category,
        fetchFn,
      );
      fetchedCount += categoryRecords.length;
      records.push(...categoryRecords);
      categoryStats.push({
        category,
        recordCount: categoryRecords.length,
        status: categoryRecords.length > 0 ? "ok" : "empty",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`bioRxiv category skipped (${category}):`, message);
      categoryStats.push({
        category,
        recordCount: 0,
        status: "skipped",
        error: message,
      });
    }
  }

  return {
    records,
    categoryCount: options.categories.length,
    fetchedCount,
    categoryStats,
  };
}

export { PAGE_SIZE as BIORXIV_PAGE_SIZE };
