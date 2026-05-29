import type { SourceScope } from "./types.js";

const DEFAULT_SOURCE_SCOPE: SourceScope = "life-science-only";

export function resolveSourceScope(
  sourceId: string,
  scopeBySourceId: ReadonlyMap<string, SourceScope>,
): SourceScope {
  return scopeBySourceId.get(sourceId) ?? DEFAULT_SOURCE_SCOPE;
}
