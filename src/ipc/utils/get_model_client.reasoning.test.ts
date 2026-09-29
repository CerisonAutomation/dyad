import { afterEach, describe, expect, test } from "vitest";
import { withReasoningAsContent } from "./get_model_client";

function sseResponse(lines: string[]): Response {
  const body = lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function drain(response: Response): Promise<string> {
  return await response.text();
}

const REASONING_ONLY_CHUNKS = [
  JSON.stringify({
    choices: [{ delta: { reasoning: "thinking hard", content: null } }],
  }),
  JSON.stringify({
    choices: [
      { delta: {}, finish_reason: "length" },
    ],
  }),
];

describe("withReasoningAsContent", () => {
  const original = process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
    } else {
      process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE = original;
    }
  });

  test("folds reasoning into content on a reasoning-only SSE stream", async () => {
    delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
    const base = async () => sseResponse(REASONING_ONLY_CHUNKS);
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;

    const text = await drain(await wrapped("https://example.test/v1"));
    expect(text).toContain('"content":"thinking hard"');
  });

  test("the diagnostic does NOT disable the fold", async () => {
    // Regression: the tap used to return early, so enabling the diagnostic
    // silently turned the reasoning fold off and the failure came back.
    process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE = "1";
    const base = async () => sseResponse(REASONING_ONLY_CHUNKS);
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;

    const text = await drain(await wrapped("https://example.test/v1"));
    expect(text).toContain('"content":"thinking hard"');
  });

  test("leaves real content untouched", async () => {
    delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
    const base = async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "real answer" } }] }),
      ]);
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;

    const text = await drain(await wrapped("https://example.test/v1"));
    expect(text).toContain('"content":"real answer"');
    expect(text).not.toContain("thinking hard");
  });

  test("folds reasoning on a non-streaming JSON response", async () => {
    delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
    const base = async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: null, reasoning: "just thinking" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;

    const text = await drain(await wrapped("https://example.test/v1"));
    expect(text).toContain('"content":"just thinking"');
  });

  test("passes an error response through with its body intact", async () => {
    // A rejected request is a different failure from an empty completion; it
    // must not be swallowed or have its body consumed by the diagnostic.
    process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE = "1";
    const base = async () =>
      new Response('{"error":{"message":"context length exceeded"}}', {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      });
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;

    const response = await wrapped("https://example.test/v1");
    expect(response.status).toBe(400);
    expect(await drain(response)).toContain("context length exceeded");
  });

  test("wraps the global fetch when no override is supplied", async () => {
    // Regression: the production call site passes getTestFetchOption().fetch,
    // which is undefined outside tests. Returning undefined here made the fold
    // and the diagnostic dead code in a real build while every unit test - which
    // passes an explicit stub - stayed green.
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return sseResponse(REASONING_ONLY_CHUNKS);
    }) as typeof fetch;

    try {
      delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
      const wrapped = withReasoningAsContent(undefined);
      expect(typeof wrapped).toBe("function");

      const text = await drain(await wrapped!("https://example.test/v1"));
      expect(calls).toEqual(["https://example.test/v1"]);
      expect(text).toContain('"content":"thinking hard"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
