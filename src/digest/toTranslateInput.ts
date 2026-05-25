import type { ClassifiedPaper } from "../types.js";
import type { DigestTranslateInput } from "./types.js";

export function toDigestTranslateInput(paper: ClassifiedPaper): DigestTranslateInput {
  return {
    id: paper.id,
    title: paper.title,
    journal: paper.journal,
  };
}
