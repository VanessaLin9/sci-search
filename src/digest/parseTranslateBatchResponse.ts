/**
 * Translate batch structured-output：逐項驗證 + partial salvage（PR #31）。
 *
 * - 整體 JSON／頂層 shape 壞掉 → 整批失敗（呼叫端維持英文 fallback）
 * - results 內部分 item 壞掉 → 只丟棄不安全項，合法且 id 可確認的保留
 * - identity 只認 `id`；不靠 index／順序／title（避免 A→B 錯配）
 * - 同批 duplicate `id`：fail closed，該 id 全部不寫入；malformed／空標題 duplicate 仍計入 invalid（PR #31 review）
 * - 觸發：2026-07-31 單列 `invalid_type` 曾讓整批 titleZh 消失
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

/** 正規化 raw／parsed id；空白-only 視為無 identity。 */
function normalizeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractRawStringId(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  return normalizeId((row as { id?: unknown }).id);
}

function discardId(
  id: string,
  titleZhById: Map<string, string>,
  blockedIds: Set<string>,
): void {
  titleZhById.delete(id);
  blockedIds.add(id);
}

/**
 * 解析 translate LLM content（PR #31）。
 * `expectedIds` 順序只用於 missing 回報，對應 key 一律用 `id`。
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
  const blockedIds = new Set<string>();
  const seenExpectedIds = new Set<string>();
  const issues: TranslateBatchIssue[] = [];
  let invalid = 0;
  let duplicate = 0;
  let unknown = 0;

  results.forEach((row, rowIndex) => {
    // 先從 raw row 擷取 id：malformed 列仍要參與 duplicate fail-closed（PR #31 review）。
    const rawId = extractRawStringId(row);
    let duplicateOccurrence = false;
    if (rawId && expectedSet.has(rawId)) {
      if (blockedIds.has(rawId) || seenExpectedIds.has(rawId)) {
        discardId(rawId, titleZhById, blockedIds);
        duplicate += 1;
        duplicateOccurrence = true;
        issues.push({
          kind: "duplicate_id",
          path: formatZodPath(["results", rowIndex, "id"]),
          message: `duplicate id ${rawId}; all rows for this id discarded`,
          id: rawId,
        });
      } else {
        seenExpectedIds.add(rawId);
      }
    }

    // duplicate 仍繼續做 schema／trim 檢查，避免 ordering 改變 invalid 計數（PR #31 review）。
    const parsed = translateRowSchema.safeParse(row);
    if (!parsed.success) {
      invalid += 1;
      const classified = classifyRowZodIssue(parsed.error, rowIndex);
      issues.push({
        ...classified,
        id: rawId,
      });
      return;
    }

    const id = normalizeId(parsed.data.id);
    const titleZh = parsed.data.title_zh.trim();
    if (!id || !titleZh) {
      invalid += 1;
      issues.push({
        kind: !id ? "missing_field" : "empty_title",
        path: formatZodPath(["results", rowIndex, !id ? "id" : "title_zh"]),
        message: !id ? "id empty after trim" : "title_zh empty after trim",
        id,
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

    if (duplicateOccurrence || blockedIds.has(id)) {
      return;
    }

    titleZhById.set(id, titleZh);
  });

  const failedIds = expectedIds.filter((id) => !titleZhById.has(id));
  const salvaged = titleZhById.size;

  return {
    batchFailed: false,
    titleZhById,
    failedIds,
    summary: {
      requested: expectedIds.length,
      // valid 與 salvaged 皆為最終寫入數，避免手動 counter 與 map 不同步。
      valid: salvaged,
      salvaged,
      invalid,
      missing: failedIds.length,
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
