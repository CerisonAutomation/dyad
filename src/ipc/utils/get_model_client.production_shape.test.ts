import { afterEach, describe, expect, test, vi } from "vitest";
import type { UserSettings } from "../../lib/schemas";
import { getModelClient } from "./get_model_client";
import { isRetryableProviderStreamError } from "@/pro/main/ipc/handlers/local_agent/local_agent_handler";

// getModelClient resolves the provider list through the database; this test is
// about the fetch wiring, so the catalog is stubbed to a single kilocode entry.
vi.mock("@/ipc/shared/language_model_helpers", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/ipc/shared/language_model_helpers")
  >();
  return {
    ...actual,
    getLanguageModelProviders: async () => [
      {
        id: "kilocode",
        name: "Kilo Code",
        type: "cloud",
        envVarName: "KILOCODE_API_KEY",
        apiKey: KILO_KEY,
      },
    ],
    getLanguageModels: async () => [
      {
        name: "stealth/space-bunny-alpha",
        id: "stealth/space-bunny-alpha",
        provider: "kilocode",
        providerId: "kilocode",
        type: "cloud",
        apiName: "stealth/space-bunny-alpha",
        dollarSigns: 0,
        contextWindow: 200000,
      },
    ],
  };
});

/**
 * These tests deliberately run with NO test-fetch override installed, because
 * that is the production shape: getTestFetchOption() returns {} in a real
 * build, which is the exact case that used to make withReasoningAsContent
 * return undefined and silently disable both the fold and the diagnostic.
 */

const KILO_KEY = "test-kilo-key";

function settings(): UserSettings {
  return {
    providerSettings: {
      kilocode: { apiKey: { value: KILO_KEY } },
    },
  } as unknown as UserSettings;
}

function sseBody(lines: string[]): string {
  return lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
}

const REASONING_ONLY = sseBody([
  JSON.stringify({
    choices: [{ delta: { reasoning: "thinking", content: null } }],
  }),
  JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] }),
]);

function sseResponse(): Response {
  return new Response(REASONING_ONLY, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("getModelClient production fetch wiring (kilocode)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("attaches a real fetch and folds a reasoning-only stream", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      void init;
      return sseResponse();
    }) as typeof fetch;

    const { modelClient } = await getModelClient(
      { name: "stealth/space-bunny-alpha", provider: "kilocode" } as never,
      settings(),
    );

    const result = await (modelClient.model as unknown as { doStream: (o: unknown) => Promise<any> }).doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as never);

    // The wrapper is really attached: the request went through the global fetch.
    expect(seen.length).toBe(1);

    // And it rewrote the chunk, so the turn is no longer empty.
    const text: string[] = [];
    for await (const part of readStream(result.stream)) {
      if (part.type === "text-delta" && part.delta) text.push(part.delta);
    }
    expect(text.join("")).toContain("thinking");
  });

  test("surfaces a gateway rejection as a retryable stream error", async () => {
    globalThis.fetch = (async () =>
      new Response("Provider returned an empty response", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })) as typeof fetch;

    const { modelClient } = await getModelClient(
      { name: "stealth/space-bunny-alpha", provider: "kilocode" } as never,
      settings(),
    );

    let thrown: unknown;
    try {
      await (modelClient.model as unknown as { doStream: (o: unknown) => Promise<any> }).doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(getErrorText(thrown)).toContain("Provider returned an empty response");
    // The whole point: the agent's retry classifier must accept it, whether it
    // arrives as an Error or as the bare string the SDK sometimes produces.
    expect(isRetryableProviderStreamError(thrown)).toBe(true);
    expect(isRetryableProviderStreamError("Provider returned an empty response")).toBe(
      true,
    );
  });
});

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    // The AI SDK carries the provider's own error text in responseBody; the
    // message alone is often empty, which is part of why this failure was so
    // hard to trace.
    const withBody = error as Error & { responseBody?: unknown; cause?: unknown };
    return [
      error.message,
      typeof withBody.responseBody === "string"
        ? withBody.responseBody
        : JSON.stringify(withBody.responseBody ?? ""),
      String(withBody.cause ?? ""),
    ].join(" ");
  }
  return String(error);
}

async function* readStream(stream: unknown): AsyncGenerator<any> {
  const reader = (stream as ReadableStream<any>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
