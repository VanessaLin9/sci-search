import OpenAI from "openai";
import { getDigestLlmConfig, type DigestLlmConfig } from "./config.js";

const clientCache = new Map<string, OpenAI>();

export type DigestLlmClientOptions = {
  timeoutMs?: number;
  maxRetries?: number;
};

function clientCacheKey(
  config: DigestLlmConfig,
  options?: DigestLlmClientOptions,
): string {
  const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
  const maxRetries = options?.maxRetries ?? config.maxRetries;
  return `${config.baseUrl}|${config.apiKey.slice(0, 8)}|${timeoutMs}|${maxRetries}`;
}

export function createDigestLlmClient(
  config = getDigestLlmConfig(),
  options?: DigestLlmClientOptions,
): OpenAI {
  const key = clientCacheKey(config, options);
  const cached = clientCache.get(key);
  if (cached) {
    return cached;
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: options?.timeoutMs ?? config.timeoutMs,
    maxRetries: options?.maxRetries ?? config.maxRetries,
  });
  clientCache.set(key, client);
  return client;
}
