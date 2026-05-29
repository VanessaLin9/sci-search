import type { DigestLine } from "../types.js";

export type DigestLineSectionConfig = {
  line: DigestLine;
  badgeStyle: string;
  badgeLabel: string;
  heading: string;
};

/** Email main-line badges and section headings (INV-039) — copy must stay byte-identical. */
export const LINE_SECTIONS: DigestLineSectionConfig[] = [
  {
    line: "line-a",
    badgeStyle: "background:#eaf2f8;color:#2c5f8d;",
    badgeLabel: "主線 A",
    heading: "單細胞 / 空間組學",
  },
  {
    line: "line-b",
    badgeStyle: "background:#e6f4ec;color:#2f7a4f;",
    badgeLabel: "主線 B",
    heading: "當日其他重要生物學發現",
  },
  {
    line: "preprint",
    badgeStyle: "background:#fdf2e6;color:#b85c00;",
    badgeLabel: "預印本",
    heading: "bioRxiv / medRxiv",
  },
];
