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
  /** OpenAI json_object mode; skipped on NVIDIA if unsupported. */
  preferJsonResponseFormat: boolean;
  /** GLM / NVIDIA: disable chain-of-thought for cheap routing. */
  disableThinking: boolean;
};

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
  const batchSize = Number.parseInt(process.env.ROUTING_LLM_BATCH_SIZE ?? "25", 10);
  const nvidia = isNvidiaIntegrateApi(baseUrl);

  const thinkingFlag = process.env.ROUTING_LLM_ENABLE_THINKING?.trim().toLowerCase();
  const enableThinking = thinkingFlag === "1" || thinkingFlag === "true";

  return {
    apiKey,
    baseUrl,
    model,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 25,
    preferJsonResponseFormat: !nvidia,
    disableThinking: nvidia && !enableThinking,
  };
}
