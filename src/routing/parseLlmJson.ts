/** Strip optional markdown fences before JSON.parse. */
export function parseJsonFromLlmContent(content: string): unknown {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(jsonText);
  } catch (directError) {
    const extracted = extractFirstJsonObject(jsonText);
    if (!extracted) {
      throw directError;
    }
    try {
      return JSON.parse(extracted);
    } catch {
      throw directError;
    }
  }
}

/** Pull the first top-level `{...}` object (tolerates leading analysis prose). */
export function extractFirstJsonObject(text: string): string | null {
  const resultsStart = text.indexOf('{"results"');
  const start = resultsStart >= 0 ? resultsStart : text.indexOf("{");
  if (start < 0) {
    return null;
  }
  return sliceBalancedBraces(text, start);
}

function sliceBalancedBraces(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}
