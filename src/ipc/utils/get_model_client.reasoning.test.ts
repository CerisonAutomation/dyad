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

describe("withReasoningAsContent diagnostics", () => {
  test("does not report a tool-calling turn as an empty response", async () => {
    // Observed live: a working agent step streams {content: null, tool_calls: [...]}
    // and finishes with finish_reason "tool_calls". That is a valid completion
    // with no text, and flagging it as an empty response cried wolf on every
    // single tool call the agent made.
    process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE = "1";
    const base = async () =>
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { content: null, role: "assistant", tool_calls: [{ index: 0 }] } }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ]);
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      await drain(await wrapped("https://example.test/v1"));
    } finally {
      console.error = originalError;
      delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
    }
    expect(errors.join("\n")).not.toContain("Stream produced no content");
  });
});

describe("gateway errors embedded in a 200 SSE stream", () => {
  test("fails the stream with the upstream code instead of empty choices", async () => {
    // Captured live: Kilo returns HTTP 200 with
    //   {"choices": [], "error": {"code": 502, "message": "..."}}
    // The reader sees zero choices and reports a generic "empty response",
    // discarding the code that says it was a retryable gateway fault.
    process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE = "1";
    const base = async () =>
      sseResponse([
        JSON.stringify({
          id: "gen-x",
          object: "chat.completion.chunk",
          model: "stealth/space-bunny-alpha",
          provider: "Stealth",
          choices: [],
          error: { code: 502, message: "Provider returned an empty response" },
        }),
      ]);
    const wrapped = withReasoningAsContent(base as unknown as typeof fetch)!;
    const response = await wrapped("https://example.test/v1");

    let thrown: any;
    // Read via a reader, the way the provider consumes the stream.
    try {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
      reader.releaseLock();
    } catch (error) {
      thrown = error;
    }
    delete process.env.DYAD_LOG_EMPTY_MODEL_RESPONSE;
    expect(thrown).toBeDefined();
    expect(thrown.statusCode).toBe(502);
    expect(thrown.isRetryable).toBe(true);
  });
});
