import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessedPapersFile } from "../../src/processedData.js";
import { validateProcessedPapersFile } from "../../src/processedData.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/regression");

export function loadRegressionFixture(reportDate: string): ProcessedPapersFile {
  const path = join(FIXTURE_DIR, `${reportDate}-papers.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return validateProcessedPapersFile(raw);
}

export type RegressionExpectations = {
  reportDate: string;
  paperCount: number;
  featured: number;
  overflow: number;
  skip: number;
};

export const REGRESSION_EXPECTATIONS: Record<string, RegressionExpectations> = {
  "2026-05-22": {
    reportDate: "2026-05-22",
    paperCount: 34,
    featured: 12,
    overflow: 20,
    skip: 2,
  },
  "2026-05-24": {
    reportDate: "2026-05-24",
    paperCount: 0,
    featured: 0,
    overflow: 0,
    skip: 0,
  },
  "2026-06-10": {
    reportDate: "2026-06-10",
    paperCount: 64,
    featured: 12,
    overflow: 40,
    skip: 12,
  },
};
