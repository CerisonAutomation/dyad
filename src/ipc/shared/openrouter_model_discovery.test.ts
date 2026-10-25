import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOpenRouterModels } from "./openrouter_model_discovery";
const row = (extra = {}) => ({
  id: "test:free",
  name: "Test",
  pricing: { prompt: "0", completion: "0" },
  supported_parameters: ["tools"],
  ...extra,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("provider discovery parsing", () => {
  it("extracts capabilities and verifies every price", () => {
    const [model] = parseOpenRouterModels({
      data: [
        row({
          context_length: 32768,
          top_provider: { max_completion_tokens: 4096 },
        }),
      ],
    });
    expect(model).toMatchObject({
      isFree: true,
      supportsTools: true,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    });
  });
  it.each([
    undefined,
    {},
    { prompt: "", completion: "0" },
    { prompt: "0", completion: "0", request: "0.01" },
    { prompt: "-1", completion: "0" },
    { prompt: "NaN", completion: "0" },
  ])("does not advertise ambiguous/nonzero pricing as free: %j", (pricing) => {
    expect(parseOpenRouterModels({ data: [row({ pricing })] })[0].isFree).toBe(
      false,
    );
  });
  it("drops malformed rows and duplicates", () => {
    expect(
      parseOpenRouterModels({ data: [{ id: 3 }, row(), row()] }),
    ).toHaveLength(1);
    expect(() => parseOpenRouterModels({ data: "no" })).toThrow();
  });
  it("coalesces requests, rejects redirects and sends no credentials", async () => {
    vi.resetModules();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [row()] })),
    );
    vi.stubGlobal("fetch", fetch);
    const { discoverOpenRouterModels } =
      await import("./openrouter_model_discovery");
    const results = await Promise.all([
      discoverOpenRouterModels(),
      discoverOpenRouterModels(),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        redirect: "error",
        headers: { Accept: "application/json" },
      }),
    ]);
    await discoverOpenRouterModels();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps last-known-good metadata after a failed refresh", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row()] })))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const { discoverOpenRouterModels } =
      await import("./openrouter_model_discovery");
    const first = await discoverOpenRouterModels();
    vi.advanceTimersByTime(300001);
    expect(await discoverOpenRouterModels()).toEqual(first);
    await discoverOpenRouterModels();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("fails safely on oversized metadata", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(" ".repeat(2 * 1024 * 1024 + 1))),
    );
    const { discoverOpenRouterModels } =
      await import("./openrouter_model_discovery");
    expect(await discoverOpenRouterModels()).toBeUndefined();
  });
});
it.each(["0x0", "0b0", "", "  ", "Infinity", "-0"])(
  "does not coerce non-decimal price metadata into free: %s",
  (value) => {
    expect(
      parseOpenRouterModels({
        data: [row({ pricing: { prompt: value, completion: "0" } })],
      })[0].isFree,
    ).toBe(false);
  },
);
it("does not block a warm catalog on a slow refresh", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  let refresh!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row()] })))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            refresh = resolve;
          }),
      ),
  );
  const { discoverOpenRouterModels } =
    await import("./openrouter_model_discovery");
  const first = await discoverOpenRouterModels();
  vi.advanceTimersByTime(300001);
  expect(await discoverOpenRouterModels()).toEqual(first);
  refresh(new Response(JSON.stringify({ data: [row()] })));
});
it("isolates the cached catalog from caller mutations", async () => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [row()] }))),
  );
  const { discoverOpenRouterModels } =
    await import("./openrouter_model_discovery");
  const first = await discoverOpenRouterModels();
  first![0].isFree = false;
  expect((await discoverOpenRouterModels())![0].isFree).toBe(true);
});
it("expires free-pricing claims during a prolonged provider outage", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row()] })))
      .mockRejectedValue(new Error("offline")),
  );
  const { discoverOpenRouterModels } =
    await import("./openrouter_model_discovery");
  await discoverOpenRouterModels();
  vi.advanceTimersByTime(1800001);
  const stale = await discoverOpenRouterModels();
  expect(stale![0]).toMatchObject({ apiName: "test:free", isFree: false });
  expect(stale![0].description).toContain("expired");
});
it("does not promote conflicting duplicate rows into free automatic routing", () => {
  const [model] = parseOpenRouterModels({
    data: [
      row(),
      row({
        pricing: { prompt: "0.1", completion: "0" },
        supported_parameters: [],
      }),
    ],
  });
  expect(model.isFree).toBe(false);
  expect(model.supportsTools).toBe(false);
  expect(model.tag).toBeUndefined();
});
it("a later free duplicate cannot override an earlier paid row", () => {
  const [model] = parseOpenRouterModels({
    data: [row({ pricing: { prompt: "0.1", completion: "0" } }), row()],
  });
  expect(model.isFree).toBe(false);
});
it("aborts unsuccessful responses and backs off instead of looping", async () => {
  vi.resetModules();
  let signal: AbortSignal | undefined;
  const fetch = vi.fn(async (_url, init) => {
    signal = init.signal;
    return new Response("unavailable", { status: 503 });
  });
  vi.stubGlobal("fetch", fetch);
  const { discoverOpenRouterModels } =
    await import("./openrouter_model_discovery");
  expect(await discoverOpenRouterModels()).toBeUndefined();
  expect(signal?.aborted).toBe(true);
  await discoverOpenRouterModels();
  expect(fetch).toHaveBeenCalledOnce();
});
it("aborts a stalled first load at its deadline", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
  );
  const { discoverOpenRouterModels } =
    await import("./openrouter_model_discovery");
  const pending = discoverOpenRouterModels();
  await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toBeUndefined();
});
