import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it, vi, afterEach } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import {
  AI_SDK_MAX_ATTEMPTS,
  AI_SDK_MAX_BACKOFF_MS,
  AI_SDK_MAX_RETRIES,
} from "./ai_retry_budget";

/**
 * The upstream gateway error the app saw in production:
 * "Upstream request failed: Endpoint is unavailable."
 */
function transientUpstreamError(): APICallError {
  return new APICallError({
    message: "Upstream request failed: Endpoint is unavailable.",
    url: "https://engine.dyad.sh/v1/chat/completions",
    requestBodyValues: {},
    cause: undefined,
    isRetryable: true,
  });
}

function successfulStream(): ReadableStream<LanguageModelV3StreamPart> {
  return convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "0" },
    { type: "text-delta", id: "0", delta: "recovered" },
    { type: "text-end", id: "0" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ]);
}

/**
 * The SDK retries with exponential backoff (2s, 4s, 8s, ...). Fake timers let
 * the whole chain run instantly while still exercising the real SDK code.
 */
async function advanceThroughRetryChain(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(600_000);
  }
}

/**
 * The SDK wraps a stream failure in `NoOutputGeneratedError`; the original
 * `RetryError` (which carries the attempt count) is kept as its `cause`.
 */
function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(" | ");
}

describe("AI SDK retry budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("budgets four total attempts", () => {
    expect(AI_SDK_MAX_RETRIES).toBe(3);
    expect(AI_SDK_MAX_ATTEMPTS).toBe(4);
  });

  it("keeps the worst-case SDK backoff inside a normal turn budget", () => {
    // The SDK sleeps 2s, 4s, 8s ... between attempts. A large retry budget
    // made one failing request hang a turn for many minutes.
    expect(AI_SDK_MAX_BACKOFF_MS).toBe(14_000);
  });

  it("recovers when the upstream clears on the last allowed attempt", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async (_options) => {
        calls += 1;
        if (calls < AI_SDK_MAX_ATTEMPTS) {
          throw transientUpstreamError();
        }
        return { stream: successfulStream() };
      },
    });

    const result = streamText({
      model,
      prompt: "hello",
      maxRetries: AI_SDK_MAX_RETRIES,
    });
    const settled = result.text.then(
      (text) => ({ ok: true as const, text }),
      (error) => ({ ok: false as const, error }),
    );

    await advanceThroughRetryChain();
    const outcome = await settled;

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.text).toBe("recovered");
    expect(calls).toBe(AI_SDK_MAX_ATTEMPTS);
  });

  it("keeps retrying past the old three-attempt ceiling", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async (_options) => {
        calls += 1;
        if (calls <= 3) {
          throw transientUpstreamError();
        }
        return { stream: successfulStream() };
      },
    });

    const result = streamText({
      model,
      prompt: "hello",
      maxRetries: AI_SDK_MAX_RETRIES,
    });
    const settled = result.text.then(
      (text) => ({ ok: true as const, text }),
      (error) => ({ ok: false as const, error }),
    );

    await advanceThroughRetryChain();
    const outcome = await settled;

    // The previous budget (maxRetries: 2 => 3 attempts) died here with
    // "AI_RetryError: Failed after 3 attempts".
    expect(outcome.ok).toBe(true);
    expect(calls).toBe(4);
  });

  it("still surfaces the error after the budget is exhausted", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let capturedError: unknown;
    const model = new MockLanguageModelV3({
      doStream: async (_options) => {
        calls += 1;
        throw transientUpstreamError();
      },
    });

    const result = streamText({
      model,
      prompt: "hello",
      maxRetries: AI_SDK_MAX_RETRIES,
      onError: ({ error }) => {
        capturedError = error;
      },
    });
    const settled = result.text.then(
      (text) => ({ ok: true as const, text }),
      (error) => ({ ok: false as const, error }),
    );

    await advanceThroughRetryChain();
    const outcome = await settled;

    expect(outcome.ok).toBe(false);
    expect(calls).toBe(AI_SDK_MAX_ATTEMPTS);
    // The SDK reports the retry exhaustion through `onError`; the stream
    // itself ends with a generic "no output generated" error.
    expect(collectErrorText(capturedError)).toMatch(/Failed after 4 attempts/);
  });
});
