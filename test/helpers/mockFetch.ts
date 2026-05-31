import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { loadRssSnapshotUrlMap } from "./rssSnapshots.js";

const GOLDEN_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden");

/** Small single-feed fixture for the minimal synthetic E2E test. */
const GOLDEN_RSS_BY_URL: Record<string, string> = {
  "https://www.nature.com/nmeth.rss": join(GOLDEN_FIXTURE_DIR, "rss/nature-methods.xml"),
};

export type MockFetchOptions = {
  /** Load RSS from test/fixtures/rss-snapshots/{reportDate}/ (no network). */
  reportDate?: string;
};

type ChatMessage = { role?: string; content?: string };

type ChatRequestBody = {
  messages?: ChatMessage[];
};

async function readRequestBody(body: RequestInit["body"]): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Buffer) return body.toString("utf8");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return await new Response(body).text();
}

function extractJsonPayload(content: string): Record<string, unknown> {
  const start = content.indexOf("{");
  if (start === -1) {
    throw new Error("mock LLM: user message has no JSON payload");
  }
  return JSON.parse(content.slice(start)) as Record<string, unknown>;
}

function chatCompletion(content: string): ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
  };
}

function jsonResponse(content: unknown): Response {
  return new Response(JSON.stringify(chatCompletion(JSON.stringify(content))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/rss+xml" },
  });
}

function mockArticleHtmlResponse(): Response {
  const html = `<!DOCTYPE html><html><head><meta name="description" content="Fixture abstract for E2E enrich step. This placeholder is long enough to pass minimum abstract length checks in tests." /></head><body></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function mockCrossrefResponse(): Response {
  const body = {
    message: {
      abstract:
        "<jats:p>Fixture abstract from Crossref for E2E testing. Repeated text to satisfy minimum abstract length.</jats:p>",
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function isSingleCellCandidate(text: string): boolean {
  return /single-cell|single cell|spatial/i.test(text);
}

function paperText(paper: { title?: string; abstract?: string }): string {
  return `${paper.title ?? ""} ${paper.abstract ?? ""}`;
}

function mockRoutingResponse(payload: Record<string, unknown>): Response {
  const papers = payload.papers as Array<{ id: string }> | undefined;
  if (!papers) {
    throw new Error("mock LLM routing: missing papers array");
  }
  return jsonResponse({
    results: papers.map((paper) => ({ id: paper.id, verdict: "yes" })),
  });
}

function mockTaggingResponse(payload: Record<string, unknown>): Response {
  const papers = payload.papers as Array<{ id: string; title?: string; abstract?: string }>;
  return jsonResponse({
    results: papers.map((paper) => {
      const title = paper.title ?? "";
      if (/^Editorial:/i.test(title)) {
        return { id: paper.id, digest_line: "skip" };
      }
      if (isSingleCellCandidate(paperText(paper))) {
        return { id: paper.id, digest_line: "line-a" };
      }
      return { id: paper.id, digest_line: "line-b" };
    }),
  });
}

function mockSummarizeResponse(payload: Record<string, unknown>): Response {
  const paper = payload.paper as { id: string; title?: string };
  return jsonResponse({
    id: paper.id,
    title_zh: `測試標題：${paper.title ?? paper.id}`,
    summary_zh: "這是 E2E 測試用的繁中摘要，用來驗證 featured 卡片格式。",
    topic_tags: ["test-tag", "methods"],
  });
}

function mockTranslateResponse(payload: Record<string, unknown>): Response {
  const papers = payload.papers as Array<{ id: string; title?: string }>;
  return jsonResponse({
    results: papers.map((paper) => ({
      id: paper.id,
      title_zh: `譯名：${paper.title ?? paper.id}`,
    })),
  });
}

function emptyBiorxivResponse(): Response {
  const body = {
    messages: [{ status: "ok", cursor: 0, count: 0, total: "0" }],
    collection: [],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockChatCompletion(body: string): Response {
  const request = JSON.parse(body) as ChatRequestBody;
  const system = request.messages?.find((message) => message.role === "system")?.content ?? "";
  const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
  const payload = extractJsonPayload(user);

  if (system.includes("classify scientific papers for a life-science daily digest")) {
    return mockRoutingResponse(payload);
  }
  if (system.includes("assign each paper to a digest main-line bucket")) {
    return mockTaggingResponse(payload);
  }
  if (system.includes("featured-card copy")) {
    return mockSummarizeResponse(payload);
  }
  if (system.includes("translate English paper titles")) {
    return mockTranslateResponse(payload);
  }

  throw new Error(`mock LLM: unrecognized system prompt: ${system.slice(0, 80)}…`);
}

function buildRssByUrl(options: MockFetchOptions): Map<string, string> {
  const rssByUrl = new Map<string, string>();

  if (options.reportDate) {
    for (const [url, path] of loadRssSnapshotUrlMap(options.reportDate)) {
      rssByUrl.set(url, path);
    }
  }

  for (const [url, path] of Object.entries(GOLDEN_RSS_BY_URL)) {
    if (!rssByUrl.has(url)) {
      rssByUrl.set(url, path);
    }
  }

  return rssByUrl;
}

export function createMockFetch(options: MockFetchOptions = {}): typeof fetch {
  const rssByUrl = buildRssByUrl(options);

  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.includes("/chat/completions")) {
      const body = await readRequestBody(init?.body);
      return mockChatCompletion(body);
    }

    if (url.startsWith("https://api.crossref.org/works/")) {
      return mockCrossrefResponse();
    }

    if (url.includes("api.biorxiv.org/details/biorxiv")) {
      return emptyBiorxivResponse();
    }

    if (url.includes("nature.com/articles/")) {
      return mockArticleHtmlResponse();
    }

    const rssPath = rssByUrl.get(url);
    if (rssPath) {
      return xmlResponse(readFileSync(rssPath, "utf8"));
    }

    throw new Error(
      `Unexpected fetch in E2E test (no fixture): ${url}\n` +
        `Registered RSS URLs: ${[...rssByUrl.keys()].join(", ") || "(none)"}`,
    );
  };
}
