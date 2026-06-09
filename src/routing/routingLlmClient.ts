import OpenAI from "openai";
import { getRoutingLlmConfig, type RoutingLlmConfig } from "./config.js";

let cachedClient: OpenAI | null = null;
let cachedConfigKey: string | null = null;

function configCacheKey(config: RoutingLlmConfig): string {
  return `${config.baseUrl}|${config.apiKey.slice(0, 8)}|${config.timeoutMs}|${config.maxRetries}`;
}

export function createRoutingLlmClient(config = getRoutingLlmConfig()): OpenAI {
  const key = configCacheKey(config);
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }

  cachedClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  cachedConfigKey = key;
  return cachedClient;
}

/** Test-only: clear cached client so mocked global fetch is picked up. */
export function resetRoutingLlmClientCache(): void {
  cachedClient = null;
  cachedConfigKey = null;
}
