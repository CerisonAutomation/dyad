import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const fetchMock = vi.fn();

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("./network_utils", () => ({
  assertNotPrivateIp: vi.fn(),
  assertNotPrivateIpResolved: vi.fn(),
}));

import { localWebFetch } from "./local_web_fetch";

function makeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "Error",
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    text: async () => body,
  } as unknown as Response;
}

describe("localWebFetch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a 404 as NotFound so it is not reported as a product exception", async () => {
    fetchMock.mockResolvedValue(makeResponse(404, "nope"));

    const error = await localWebFetch("https://example.com/missing").catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(DyadError);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
    expect(error.message).toContain("404");
    expect(error.message).toContain("https://example.com/missing");
  });

  it("classifies 401/403 as Auth and 429 as RateLimited", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(401, "no"));
    const authError = await localWebFetch("https://example.com/a").catch(
      (e) => e,
    );
    expect(authError.kind).toBe(DyadErrorKind.Auth);

    fetchMock.mockResolvedValueOnce(makeResponse(403, "no"));
    const forbiddenError = await localWebFetch("https://example.com/b").catch(
      (e) => e,
    );
    expect(forbiddenError.kind).toBe(DyadErrorKind.Auth);

    fetchMock.mockResolvedValueOnce(makeResponse(429, "slow down"));
    const rateLimitedError = await localWebFetch("https://example.com/c").catch(
      (e) => e,
    );
    expect(rateLimitedError.kind).toBe(DyadErrorKind.RateLimited);
  });

  it("classifies a 4xx that is not a missing page as Validation", async () => {
    fetchMock.mockResolvedValue(makeResponse(400, "bad request"));

    const error = await localWebFetch("https://example.com/bad").catch(
      (e) => e,
    );

    expect(error.kind).toBe(DyadErrorKind.Validation);
  });

  it("does not retry a 404", async () => {
    fetchMock.mockResolvedValue(makeResponse(404, "nope"));

    await localWebFetch("https://example.com/missing").catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 and succeeds on a later attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(503, "unavailable"))
      .mockResolvedValueOnce(
        makeResponse(
          200,
          "<html><body><p>hello world content</p></body></html>",
        ),
      );

    const result = await localWebFetch("https://example.com/flaky");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.statusCode).toBe(200);
    expect(result.content).toContain("hello world content");
  });

  it("gives up after the bounded number of attempts and reports External", async () => {
    fetchMock.mockResolvedValue(makeResponse(502, "bad gateway"));

    const error = await localWebFetch("https://example.com/down").catch(
      (e) => e,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.kind).toBe(DyadErrorKind.External);
  });

  it("retries a transient network error", async () => {
    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    fetchMock
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(
        makeResponse(
          200,
          "<html><body><p>recovered content here</p></body></html>",
        ),
      );

    const result = await localWebFetch("https://example.com/reset");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toContain("recovered content");
  });

  it("follows a 303 See Other redirect", async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse(303, "", { location: "https://example.com/final" }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, "<html><body><p>final page body</p></body></html>"),
      );

    const result = await localWebFetch("https://example.com/start");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://example.com/final");
    expect(result.statusCode).toBe(200);
    expect(result.content).toContain("final page body");
  });

  it("stops at the redirect limit instead of looping forever", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(302, "", { location: "https://example.com/loop" }),
    );

    const error = await localWebFetch("https://example.com/loop").catch(
      (e) => e,
    );

    // 5 redirects are followed; the 6th response is still a redirect and is
    // reported as an error rather than retried forever.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(error).toBeInstanceOf(DyadError);
    expect(error.message).toContain("redirect");
  });

  it("honours an aborted turn signal", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockResolvedValue(
      makeResponse(200, "<html><body>x</body></html>"),
    );

    const error = await localWebFetch("https://example.com/x", {
      abortSignal: controller.signal,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(DyadError);
    expect(error.kind).toBe(DyadErrorKind.UserCancelled);
  });

  it("reports an in-flight cancellation as UserCancelled, not an upstream failure", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error("This operation was aborted"), {
      name: "AbortError",
      code: 20,
    });
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(abortError));
          setTimeout(() => controller.abort(), 0);
        }),
    );

    const error = await localWebFetch("https://example.com/slow", {
      abortSignal: controller.signal,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(DyadError);
    expect(error.kind).toBe(DyadErrorKind.UserCancelled);
    // A cancellation is terminal: it is not retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the raw HTML so links can be extracted from it", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        200,
        '<html><body><a href="/about">About</a><p>page body</p></body></html>',
      ),
    );

    const result = await localWebFetch("https://example.com/");

    // The extracted text has no markup left, so the raw HTML is what a crawl
    // needs to find the links.
    expect(result.content).not.toContain("href");
    expect(result.html).toContain('<a href="/about">');
  });

  it("stops reading the body at the byte cap instead of buffering it", async () => {
    const cancel = vi.fn();
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 100; i++) {
          controller.enqueue(chunk);
        }
      },
      cancel,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "text/html" },
      body,
    } as unknown as Response);

    const result = await localWebFetch("https://example.com/big", {
      maxLength: 100,
    });

    // The reader is cancelled as soon as the cap is reached, so the rest of
    // the body is never buffered.
    expect(cancel).toHaveBeenCalled();
    expect(result.html!.length).toBeLessThan(6 * 1024 * 1024);
    expect(result.content.length).toBeLessThan(200);
  });
});
