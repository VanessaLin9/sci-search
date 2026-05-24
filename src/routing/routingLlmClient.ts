import OpenAI from "openai";
import { getRoutingLlmConfig, type RoutingLlmConfig } from "./config.js";

let cachedClient: OpenAI | null = null;
let cachedConfigKey: string | null = null;

function configCacheKey(config: RoutingLlmConfig): string {
  return `${config.baseUrl}|${config.apiKey.slice(0, 8)}`;
}

export function createRoutingLlmClient(config = getRoutingLlmConfig()): OpenAI {
  const key = configCacheKey(config);
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }

  cachedClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
  cachedConfigKey = key;
  return cachedClient;
}
