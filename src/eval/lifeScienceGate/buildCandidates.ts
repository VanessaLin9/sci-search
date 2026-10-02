import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { currentLifeScienceGatePolicy } from "./policy.js";
import { collectHistoricalGateRows } from "./historicalPool.js";
import {
  assignSplits,
  buildCandidateGroups,
  candidateToPartialCase,
  sampleCandidateGroups,
} from "./sampleDataset.js";

async function main() {
  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "eval/life-science-gate/v1/candidates.json";
  const rows = await collectHistoricalGateRows({ includeGitHistory: true });
  const groups = buildCandidateGroups(rows);
  const sampled = sampleCandidateGroups(groups, { seed: 20261003 });
  const split = assignSplits(sampled.selected, { seed: 20261003, devFraction: 0.6 });
  const policy = currentLifeScienceGatePolicy();
  const cases = split
    .sort((left, right) => left.groupId.localeCompare(right.groupId))
    .map((item, index) =>
      candidateToPartialCase(item, `ls-gate-v1-${String(index + 1).padStart(4, "0")}`),
    );
  const payload = {
    policy,
    samplingNotes: sampled.notes,
    pool: {
      rows: rows.length,
      groups: groups.length,
    },
    cases,
  };
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stderr.write(`wrote ${outPath} cases=${cases.length}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
