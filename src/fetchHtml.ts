const DEFAULT_USER_AGENT = "paper-digest/0.1 (+https://github.com/)";
const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchHtml(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch HTML ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}
