/**
 * Translate batch structured-output：逐項驗證 + partial salvage。
 *
 * - 整體 JSON／頂層 shape 壞掉 → 整批失敗（呼叫端維持英文 fallback）
 * - results 內部分 item 壞掉 → 只丟棄不安全項，合法且 id 可確認的保留
 * - identity 只認 `id`；不靠 index／順序／title
 */
import { z } from "zod";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";

const translateRowSchema = z.object({
  id: z.string().min(1),
  title_zh: z.string().min(1),
});

export type TranslateRowIssueKind =
  | "invalid_type"
  | "missing_field"
  | "empty_title"
  | "unknown_id"
  | "duplicate_id";

export type TranslateBatchIssue =
  | { kind: "json_parse"; message: string }
  | { kind: "schema_shape"; message: string; path?: string }
  | {
      kind: TranslateRowIssueKind;
      path: string;
      message: string;
      id?: string;
    };

export type TranslateBatchParseSummary = {
  requested: number;
  valid: number;
  salvaged: number;
  invalid: number;
  missing: number;
  duplicate: number;
  unknown: number;
};

export type TranslateBatchParseResult = {
  /** 整批 JSON／頂層 shape 失敗時為 true；呼叫端應整批 fallback。 */
  batchFailed: boolean;
  titleZhById: Map<string, string>;
  failedIds: string[];
  summary: TranslateBatchParseSummary;
  issues: TranslateBatchIssue[];
};

function emptySummary(requested: number): TranslateBatchParseSummary {
  return {
    requested,
    valid: 0,
    salvaged: 0,
    invalid: 0,
    missing: requested,
    duplicate: 0,
    unknown: 0,
  };
}

function formatZodPath(path: (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path
    .map((segment, index) =>
      typeof segment === "number" ? `[${segment}]` : index === 0 ? String(segment) : `.${segment}`,
    )
    .join("");
}

function classifyRowZodIssue(
  error: z.ZodError,
  rowIndex: number,
): { kind: TranslateRowIssueKind; path: string; message: string } {
  const issue = error.issues[0];
  const path = formatZodPath(["results", rowIndex, ...issue.path]);
  const message = issue.message;

  if (issue.code === "invalid_type") {
    if (issue.received === "undefined") {
      return { kind: "missing_field", path, message };
    }
    return { kind: "invalid_type", path, message };
  }

  if (issue.code === "too_small") {
    const field = issue.path[issue.path.length - 1];
    if (field === "title_zh") {
      return { kind: "empty_title", path, message };
    }
    if (field === "id") {
      return { kind: "missing_field", path, message };
    }
  }

  return { kind: "invalid_type", path, message };
}

function batchFailure(
  expectedIds: readonly string[],
  issue: TranslateBatchIssue,
): TranslateBatchParseResult {
  return {
    batchFailed: true,
    titleZhById: new Map(),
    failedIds: [...expectedIds],
    summary: emptySummary(expectedIds.length),
    issues: [issue],
  };
}

/**
 * 解析 translate LLM content；`expectedIds` 為本批 paper id（順序僅用於 missing 回報，不作為對應 key）。
 */
export function parseTranslateBatchResponse(
  content: string,
  expectedIds: readonly string[],
): TranslateBatchParseResult {
  const expectedSet = new Set(expectedIds);
  let raw: unknown;

  try {
    raw = parseJsonFromLlmContent(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return batchFailure(expectedIds, { kind: "json_parse", message });
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return batchFailure(expectedIds, {
      kind: "schema_shape",
      path: "(root)",
      message: "expected object with results array",
    });
  }

  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return batchFailure(expectedIds, {
      kind: "schema_shape",
      path: "results",
      message: "results must be an array",
    });
  }

  const titleZhById = new Map<string, string>();
  const issues: TranslateBatchIssue[] = [];
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  let unknown = 0;

  results.forEach((row, rowIndex) => {
    const parsed = translateRowSchema.safeParse(row);
    if (!parsed.success) {
      invalid += 1;
      const classified = classifyRowZodIssue(parsed.error, rowIndex);
      const rawId =
        row && typeof row === "object" && !Array.isArray(row) && "id" in row
          ? (row as { id?: unknown }).id
          : undefined;
      issues.push({
        ...classified,
        id: typeof rawId === "string" ? rawId.trim() || undefined : undefined,
      });
      return;
    }

    const id = parsed.data.id.trim();
    const titleZh = parsed.data.title_zh.trim();
    if (!id || !titleZh) {
      invalid += 1;
      issues.push({
        kind: !id ? "missing_field" : "empty_title",
        path: formatZodPath(["results", rowIndex, !id ? "id" : "title_zh"]),
        message: !id ? "id empty after trim" : "title_zh empty after trim",
        id: id || undefined,
      });
      return;
    }

    if (!expectedSet.has(id)) {
      unknown += 1;
      issues.push({
        kind: "unknown_id",
        path: formatZodPath(["results", rowIndex, "id"]),
        message: `unknown id ${id}`,
        id,
      });
      return;
    }

    if (titleZhById.has(id)) {
      duplicate += 1;
      issues.push({
        kind: "duplicate_id",
        path: formatZodPath(["results", rowIndex, "id"]),
        message: `duplicate id ${id}`,
        id,
      });
      return;
    }

    titleZhById.set(id, titleZh);
    valid += 1;
  });

  const failedIds = expectedIds.filter((id) => !titleZhById.has(id));
  const missing = failedIds.length;
  const salvaged = titleZhById.size;

  return {
    batchFailed: false,
    titleZhById,
    failedIds,
    summary: {
      requested: expectedIds.length,
      valid,
      salvaged,
      invalid,
      missing,
      duplicate,
      unknown,
    },
    issues,
  };
}

export function formatTranslateBatchSummary(summary: TranslateBatchParseSummary): string {
  return (
    `requested=${summary.requested} valid=${summary.valid} salvaged=${summary.salvaged} ` +
    `invalid=${summary.invalid} missing=${summary.missing} ` +
    `duplicate=${summary.duplicate} unknown=${summary.unknown}`
  );
}
