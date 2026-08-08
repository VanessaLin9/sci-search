/**
 * Static caller audit for PR #35 Checkpoint 3：
 * production `chat.completions.create` / `new OpenAI` 只能出現在 allowlisted transport exits。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = join(repoRoot, "src");

/** Only these production files may call chat.completions.create (each must go via scheduler). */
const CREATE_ALLOWLIST = new Set([
  "src/routing/callRoutingCompletion.ts",
  "src/biorxiv-gate/callGateCompletion.ts",
  "src/digest/callDigestCompletion.ts",
  "src/digest/callDigestChat.ts",
  "src/digest/probeDigestSmoke.ts",
]);

/** OpenAI client construction is only allowed in the two factories. */
const OPENAI_CTOR_ALLOWLIST = new Set([
  "src/routing/routingLlmClient.ts",
  "src/digest/digestLlmClient.ts",
]);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function linesMatching(filePath: string, pattern: RegExp): number[] {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i]!)) hits.push(i + 1);
  }
  return hits;
}

describe("llm caller audit", () => {
  test("chat.completions.create only appears in allowlisted transport exits", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(srcRoot)) {
      const rel = relative(repoRoot, file).replaceAll("\\", "/");
      // Require a real call site (`.create(`), so comment-only mentions are ignored.
      const hits = linesMatching(file, /\.chat\.completions\.create\s*\(/);
      if (hits.length === 0) continue;
      if (!CREATE_ALLOWLIST.has(rel)) {
        offenders.push(`${rel}:${hits.join(",")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `unexpected chat.completions.create sites (must use shared scheduler):\n${offenders.join("\n")}`,
    );
  });

  test("new OpenAI only appears in routing/digest client factories", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(srcRoot)) {
      const rel = relative(repoRoot, file).replaceAll("\\", "/");
      const hits = linesMatching(file, /new OpenAI\b/);
      if (hits.length === 0) continue;
      if (!OPENAI_CTOR_ALLOWLIST.has(rel)) {
        offenders.push(`${rel}:${hits.join(",")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `unexpected new OpenAI sites:\n${offenders.join("\n")}`,
    );
  });

  test("allowlisted create sites schedule via shared transport or JSON-fallback wrapper", () => {
    for (const rel of CREATE_ALLOWLIST) {
      const text = readFileSync(join(repoRoot, rel), "utf8");
      const viaWrapper =
        text.includes("createChatCompletionWithJsonResponseFormatFallback") ||
        text.includes("scheduleLlmTransportAttempt");
      assert.ok(
        viaWrapper,
        `${rel} must call scheduleLlmTransportAttempt or the JSON-fallback wrapper`,
      );
      assert.match(text, /maxRetries:\s*0/, `${rel} must force maxRetries: 0`);
    }
  });
});
