import type { Paper } from "../types.js";
import type { BroadScienceRoutingInput } from "./types.js";

export function toBroadScienceRoutingInput(paper: Paper): BroadScienceRoutingInput {
  return {
    id: paper.id,
    title: paper.title,
    journal: paper.journal,
    source_id: paper.sourceId,
  };
}
