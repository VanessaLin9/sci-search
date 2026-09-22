/**
 * Digest HTML footer lines for the day's routing／digest LLM models.
 * Names always come from persisted usage — never hardcoded provider ids.
 */
import type { DigestLlmModelsSnapshot, LlmModelUsage } from "../llm/llmModelUsage.js";
import { displayLlmModel } from "../llm/llmModelUsage.js";

export type DigestModelFooterSource = {
  routing?: {
    enabled: boolean;
    stats?: { llmClassified?: number };
    model?: LlmModelUsage;
  };
  digest?: {
    tagging?: { llmTagged?: number };
    models?: DigestLlmModelsSnapshot;
  };
};

export function toDigestModelFooterLines(source: DigestModelFooterSource | undefined): string[] {
  if (!source) return [];

  const lines: string[] = [];
  const routingLine = formatRoutingLine(source.routing);
  if (routingLine) lines.push(routingLine);

  const models = source.digest?.models;
  if (!models) return lines;

  const spatialLine = formatSpatialLine(models.spatial, source.digest?.tagging?.llmTagged);
  if (spatialLine) lines.push(spatialLine);

  const summarizeLine = formatSummarizeLine(models.summarize);
  if (summarizeLine) lines.push(summarizeLine);

  const translateLine = formatTranslateLine(models.translate);
  if (translateLine) lines.push(translateLine);

  return lines;
}

function formatRoutingLine(
  routing: DigestModelFooterSource["routing"],
): string | undefined {
  if (!routing) return undefined;
  if (!routing.enabled) return "routing: off";
  if (!routing.model?.requested) return undefined;

  const name = displayLlmModel(routing.model);
  const llm = routing.stats?.llmClassified;
  if (llm == null) return `routing: ${name}`;
  return `routing: ${name} · llm ${llm}`;
}

function formatSpatialLine(
  spatial: DigestLlmModelsSnapshot["spatial"],
  llmTaggedFromStats?: number,
): string | undefined {
  if (!spatial?.requested) return undefined;
  const name = displayLlmModel(spatial);
  const llm = spatial.llmTagged ?? llmTaggedFromStats;
  if (llm == null) return `spatial: ${name}`;
  return `spatial: ${name} · llm ${llm}`;
}

function formatSummarizeLine(
  summarize: DigestLlmModelsSnapshot["summarize"],
): string | undefined {
  if (!summarize || summarize.requested <= 0) return undefined;

  const total = summarize.requested;
  const primaryName = displayLlmModel(summarize.primary);
  let line = `summarize: ${primaryName} ${summarize.primary.succeeded}/${total}`;

  if (summarize.fallback) {
    const fallbackName = displayLlmModel(summarize.fallback);
    line += `，fallback: ${fallbackName} ${summarize.fallback.succeeded}/${total}`;
  }
  if (summarize.failed > 0) {
    line += `，failed ${summarize.failed}`;
  }
  return line;
}

function formatTranslateLine(
  translate: DigestLlmModelsSnapshot["translate"],
): string | undefined {
  if (!translate || translate.requested <= 0) return undefined;
  const name = displayLlmModel(translate.model);
  return `translate: ${name} ${translate.succeeded}/${translate.requested}`;
}
