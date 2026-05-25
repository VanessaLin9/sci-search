import OpenAI from "openai";
import { getDigestLlmConfig, type DigestLlmConfig } from "./config.js";

let cachedClient: OpenAI | null = null;
let cachedConfigKey: string | null = null;

function configCacheKey(config: DigestLlmConfig): string {
  return `${config.baseUrl}|${config.apiKey.slice(0, 8)}|${config.timeoutMs}|${config.maxRetries}`;
}

export function createDigestLlmClient(config = getDigestLlmConfig()): OpenAI {
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
