import type { Paper } from "../types.js";
import type { BiorxivGateInput } from "./types.js";

export function toBiorxivGateInput(paper: Paper): BiorxivGateInput {
  return {
    id: paper.id,
    title: paper.title,
    abstract: paper.abstract ?? "",
  };
}
