import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { validateProcessedPapersFile, type ProcessedPapersFile } from "../processedData.js";
import { stripInlineHtml } from "../normalizers/shared.js";
import type { ClassifiedPaper } from "../types.js";

type CliOptions = {
  reportDate: string;
  inputPath?: string;
  outputDir?: string;
};

function parseCliArgs(argv: string[]): CliOptions {
  let reportDate: string | undefined;
  let inputPath: string | undefined;
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date" && argv[index + 1]) {
      reportDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      reportDate = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--input" && argv[index + 1]) {
      inputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      inputPath = arg.slice("--input=".length);
      continue;
    }
    if (arg === "--out" && argv[index + 1]) {
      outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      outputDir = arg.slice("--out=".length);
    }
  }

  if (!reportDate) {
    throw new Error("Missing required --date YYYY-MM-DD");
  }

  return {
    reportDate,
    inputPath: inputPath ?? join("data", "processed", reportDate, "papers.json"),
    outputDir: outputDir ?? join("test", "fixtures", "regression"),
  };
}

function normalizePaperTitles(papers: ClassifiedPaper[]): ClassifiedPaper[] {
  return papers.map((paper) => {
    if (!/<[a-z][\s\S]*>/i.test(paper.title)) {
      return paper;
    }
    return { ...paper, title: stripInlineHtml(paper.title) };
  });
}

function emptyDigestBlock(): NonNullable<ProcessedPapersFile["digest"]> {
  return {
    enabled: true,
    llmTagging: true,
    tagging: { llmClassified: 0, llmTagged: 0, fallback: 0 },
    selection: {
      total: 0,
      candidates: 0,
      featured: 0,
      overflow: 0,
      lineA: 0,
      lineB: 0,
      preprint: 0,
      skip: 0,
    },
    summarize: { requested: 0, llmSummarized: 0, failed: 0 },
    translate: { requested: 0, llmTranslated: 0, failed: 0 },
  };
}

function toRegressionFixture(raw: unknown, reportDate: string): ProcessedPapersFile {
  const data = raw as ProcessedPapersFile & { excludedPapers?: unknown };
  const papers = normalizePaperTitles(data.papers ?? []);

  const fixture: ProcessedPapersFile = {
    reportDate,
    generatedAt: data.generatedAt,
    papers,
    routing: data.routing,
    digest: data.digest ?? (papers.length === 0 ? emptyDigestBlock() : undefined),
  };

  return validateProcessedPapersFile(fixture);
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const raw = JSON.parse(await readFile(cli.inputPath!, "utf8"));
  const fixture = toRegressionFixture(raw, cli.reportDate);

  await mkdir(cli.outputDir!, { recursive: true });
  const outPath = join(cli.outputDir!, `${cli.reportDate}-papers.json`);
  await writeFile(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  const featured = fixture.papers.filter((paper) => paper.featured).length;
  const visible = fixture.papers.filter(
    (paper) => paper.digestLine && paper.digestLine !== "skip",
  ).length;

  console.log(`Wrote ${outPath}`);
  console.log(`  papers: ${fixture.papers.length}`);
  console.log(`  visible: ${visible}, featured: ${featured}, overflow: ${visible - featured}`);
  if (fixture.digest) {
    console.log(`  digest.selection: featured ${fixture.digest.selection.featured}, overflow ${fixture.digest.selection.overflow}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
