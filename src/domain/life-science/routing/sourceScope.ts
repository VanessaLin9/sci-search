import type { SourceScope } from "../types.js";

export function buildSourceScopeById(
  sources: ReadonlyArray<{ id: string; scope: SourceScope }>,
): ReadonlyMap<string, SourceScope> {
  return new Map(sources.map((source) => [source.id, source.scope]));
}

export function getSourceScope(
  scopeBySourceId: ReadonlyMap<string, SourceScope>,
  sourceId: string,
): SourceScope {
  const scope = scopeBySourceId.get(sourceId);
  if (!scope) {
    throw new Error(`Unknown sourceId for routing: ${sourceId}`);
  }
  return scope;
}

/** life-science-only feeds skip LLM and auto-pass routing (INV-019). */
export function passesScopeDefault(scope: SourceScope): boolean {
  return scope === "life-science-only";
}
