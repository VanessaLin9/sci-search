import { SOURCE_SCOPE_BY_ID } from "../../domain/life-science/sources.js";
import { currentLifeScienceGatePolicy } from "./policy.js";
import { lifeScienceGateDatasetSchema } from "./schema.js";
import type { DatasetIssue, LifeScienceGateCase, LifeScienceGateDataset } from "./types.js";

const BROAD_SCIENCE_SOURCE_IDS = new Set(
  Object.entries(SOURCE_SCOPE_BY_ID)
    .filter(([, scope]) => scope === "broad-science")
    .map(([sourceId]) => sourceId),
);

function issue(code: string, message: string, caseId?: string): DatasetIssue {
  return caseId ? { code, message, caseId } : { code, message };
}

export function officialGoldCase(gateCase: LifeScienceGateCase): boolean {
  return gateCase.annotationStatus === "reviewed" && gateCase.goldVerdict !== null;
}

export function validateLifeScienceGateDataset(
  data: unknown,
  options?: { expectedPolicyHash?: string },
): { dataset: LifeScienceGateDataset; issues: DatasetIssue[] } {
  const dataset = lifeScienceGateDatasetSchema.parse(data);
  const issues: DatasetIssue[] = [];
  const policy = currentLifeScienceGatePolicy();
  const expectedHash = options?.expectedPolicyHash ?? policy.policyHash;

  if (dataset.policyHash !== expectedHash) {
    issues.push(
      issue(
        "policy_hash_mismatch",
        `dataset policyHash ${dataset.policyHash} does not match current routing prompt hash ${expectedHash}`,
      ),
    );
  }

  const caseIds = new Map<string, string>();
  const groupsBySplit = new Map<string, DatasetIssue["caseId"]>();
  const inputKeys = new Map<string, string>();

  for (const gateCase of dataset.cases) {
    if (caseIds.has(gateCase.caseId)) {
      issues.push(issue("duplicate_case_id", `duplicate caseId ${gateCase.caseId}`, gateCase.caseId));
    } else {
      caseIds.set(gateCase.caseId, gateCase.split);
    }

    const previousSplit = groupsBySplit.get(gateCase.groupId);
    if (previousSplit && previousSplit !== gateCase.split) {
      issues.push(
        issue(
          "split_leak",
          `group ${gateCase.groupId} appears in both ${previousSplit} and ${gateCase.split}`,
          gateCase.caseId,
        ),
      );
    } else {
      groupsBySplit.set(gateCase.groupId, gateCase.split);
    }

    const inputKey = `${gateCase.input.id}::${normalizeTitle(gateCase.input.title)}`;
    const previousInput = inputKeys.get(inputKey);
    if (previousInput && previousInput !== gateCase.caseId) {
      issues.push(
        issue(
          "duplicate_article",
          `same article input as ${previousInput}`,
          gateCase.caseId,
        ),
      );
    } else {
      inputKeys.set(inputKey, gateCase.caseId);
    }

    if (!BROAD_SCIENCE_SOURCE_IDS.has(gateCase.input.source_id)) {
      issues.push(
        issue(
          "scope_default_sample",
          `source_id ${gateCase.input.source_id} is not a broad-science gate source`,
          gateCase.caseId,
        ),
      );
    }

    if (gateCase.sampleGroup === "hard" && gateCase.hardTags.length === 0) {
      issues.push(issue("illegal_hard_tag", "hard sample is missing hardTags", gateCase.caseId));
    }

    if (gateCase.annotationStatus === "reviewed") {
      if (!gateCase.goldVerdict || !gateCase.goldReason || !gateCase.reviewer || !gateCase.reviewedAt) {
        issues.push(
          issue(
            "reviewed_without_gold",
            "reviewed cases need goldVerdict, goldReason, reviewer, and reviewedAt",
            gateCase.caseId,
          ),
        );
      }
    } else if (gateCase.goldVerdict !== null || gateCase.goldReason !== null) {
      issues.push(
        issue(
          "unreviewed_gold",
          "gold fields must stay empty until annotationStatus is reviewed",
          gateCase.caseId,
        ),
      );
    }

    if (gateCase.annotationStatus === "disputed" && gateCase.goldVerdict !== null) {
      issues.push(
        issue("disputed_gold", "disputed cases cannot enter official gold", gateCase.caseId),
      );
    }

    if ("abstract" in gateCase.input) {
      issues.push(issue("leaked_input_field", "model input must not include abstract", gateCase.caseId));
    }
  }

  return { dataset, issues };
}

export function assertDatasetUsable(issues: DatasetIssue[]): void {
  if (issues.length > 0) {
    const details = issues.map((item) => `${item.code}: ${item.message}`).join("; ");
    throw new Error(`Dataset validation failed: ${details}`);
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}
