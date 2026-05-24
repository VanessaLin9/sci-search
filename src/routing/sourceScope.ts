import type { Source, SourceScope } from "../types.js";

export function buildSourceScopeById(sources: Source[]): ReadonlyMap<string, SourceScope> {
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
