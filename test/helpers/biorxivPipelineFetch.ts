import type { ChatCompletion } from "openai/resources/chat/completions";
import { BIORXIV_GATE_SYSTEM_PROMPT } from "../../src/biorxiv-gate/gatePrompt.js";

export type BiorxivGateFetchBehavior =
  | { kind: "verdict"; verdict: "yes" | "no" | "not_sure" }
  | { kind: "verdictById"; verdictById: Record<string, "yes" | "no" | "not_sure"> }
  | { kind: "throw"; error: Error }
  | { kind: "invalid-json" };

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

function gateCompletionResponse(
  papers: Array<{ id: string }>,
  behavior: BiorxivGateFetchBehavior,
): Response {
  if (behavior.kind === "throw") {
    throw behavior.error;
  }
  if (behavior.kind === "invalid-json") {
    return new Response(JSON.stringify(chatCompletion("not json")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const results = papers.map((paper) => {
    if (behavior.kind === "verdictById") {
      return { id: paper.id, verdict: behavior.verdictById[paper.id] ?? "no" };
    }
    return { id: paper.id, verdict: behavior.verdict };
  });

  return new Response(JSON.stringify(chatCompletion(JSON.stringify({ results }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function createBiorxivPipelineFetch(options: {
  biorxivSamplePage: unknown;
  gate: BiorxivGateFetchBehavior;
}): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("api.biorxiv.org/details/biorxiv")) {
      return new Response(JSON.stringify(options.biorxivSamplePage), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("/chat/completions")) {
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body
            ? await new Response(init.body).text()
            : "";
      const request = JSON.parse(body) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const system = request.messages?.find((message) => message.role === "system")?.content ?? "";
      if (!system.includes(BIORXIV_GATE_SYSTEM_PROMPT.slice(0, 40))) {
        throw new Error(`Unexpected chat/completions request in bioRxiv pipeline test: ${url}`);
      }
      const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
      const payloadStart = user.indexOf("{");
      const payload = JSON.parse(user.slice(payloadStart)) as {
        papers: Array<{ id: string }>;
      };
      return gateCompletionResponse(payload.papers, options.gate);
    }

    throw new Error(`Unexpected fetch in bioRxiv pipeline test: ${url}`);
  };
}
