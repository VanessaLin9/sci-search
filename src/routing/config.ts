export function isLifeScienceRoutingEnabled(): boolean {
  const flag = process.env.ROUTE_LIFE_SCIENCE?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function isNvidiaIntegrateApi(baseUrl: string): boolean {
  return baseUrl.includes("integrate.api.nvidia.com");
}

export type RoutingLlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  batchSize: number;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  /** OpenAI json_object mode; skipped on NVIDIA if unsupported. */
  preferJsonResponseFormat: boolean;
  /** GLM / NVIDIA: disable chain-of-thought for cheap routing. */
  disableThinking: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRoutingLlmConfig(): RoutingLlmConfig {
  const apiKey =
    process.env.ROUTING_LLM_API_KEY?.trim() ||
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) {
    throw new Error(
      "Life-science routing is enabled but no API key found. Set ROUTING_LLM_API_KEY, NVIDIA_API_KEY, or OPENAI_API_KEY.",
    );
  }

  const baseUrl = (
    process.env.ROUTING_LLM_BASE_URL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.ROUTING_LLM_MODEL?.trim() || "gpt-4o-mini";
  const nvidia = isNvidiaIntegrateApi(baseUrl);

  const thinkingFlag = process.env.ROUTING_LLM_ENABLE_THINKING?.trim().toLowerCase();
  const enableThinking = thinkingFlag === "1" || thinkingFlag === "true";

  const defaultBatchSize = nvidia ? 8 : 25;
  const defaultTimeoutMs = nvidia ? 180_000 : 120_000;
  const defaultMaxTokens = nvidia ? 8192 : 4096;

  return {
    apiKey,
    baseUrl,
    model,
    batchSize: parsePositiveInt(process.env.ROUTING_LLM_BATCH_SIZE, defaultBatchSize),
    timeoutMs: parsePositiveInt(process.env.ROUTING_LLM_TIMEOUT_MS, defaultTimeoutMs),
    maxTokens: parsePositiveInt(process.env.ROUTING_LLM_MAX_TOKENS, defaultMaxTokens),
    maxRetries: parsePositiveInt(process.env.ROUTING_LLM_MAX_RETRIES, 1),
    preferJsonResponseFormat: !nvidia,
    disableThinking: nvidia && !enableThinking,
  };
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "***";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}
