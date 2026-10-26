// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { generateProviderImage } from "./provider_image_generation";
const auth = vi.hoisted(() => ({ credentials: vi.fn() }));
vi.mock("../services/codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: auth.credentials,
}));
vi.mock("../shared/remote_language_model_catalog", () => ({
  getCodexClientVersion: () => "fixture-version",
}));
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const settings = () =>
  ({
    proModelUsage: "api-key",
    providerSettings: {
      images: { apiKey: { value: "DO-NOT-USE-API-KEY" } },
      openai: { apiKey: { value: "DO-NOT-USE-OPENAI-KEY" } },
    },
    imageGeneration: {
      backend: "chatgpt-subscription",
      providerId: "images",
      baseUrl: "https://api.openai.com/v1",
      model: "account-selected-image-model",
      allowPaidRemote: true,
    },
  }) as unknown as UserSettings;
const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const complete = () =>
  event({
    type: "response.output_item.done",
    item: { type: "image_generation_call", result: PNG },
  }) + event({ type: "response.completed", response: { status: "completed" } });
beforeEach(() => {
  auth.credentials
    .mockReset()
    .mockResolvedValue({
      access: "OAUTH-ACCESS",
      accountId: "SUBSCRIPTION-ACCOUNT",
    });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("sends GPT image generation exclusively to the fixed Codex subscription endpoint using OAuth", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(complete(), {
      headers: { "content-type": "text/event-stream" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    (await generateProviderImage(settings(), "lighthouse")).extension,
  ).toBe("png");
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
  expect(init.headers.Authorization).toBe("Bearer OAUTH-ACCESS");
  expect(init.headers["ChatGPT-Account-Id"]).toBe("SUBSCRIPTION-ACCOUNT");
  expect(JSON.stringify(init)).not.toContain("DO-NOT-USE");
  expect(init.redirect).toBe("error");
  const body = JSON.parse(init.body);
  expect(body.model).toBe("account-selected-image-model");
  expect(body.tools).toEqual([
    { type: "image_generation", output_format: "png" },
  ]);
  expect(body.store).toBe(false);
  expect(body.stream).toBe(true);
});
it.each([401, 403, 429, 500])(
  "does not fall back to API billing on subscription HTTP %s",
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("private upstream error", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      generateProviderImage(settings(), "lighthouse"),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledOnce();
  },
);
it("never substitutes API keys if OAuth is disconnected or refresh fails", async () => {
  auth.credentials.mockRejectedValue(new Error("unavailable OAuth"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateProviderImage(settings(), "lighthouse"),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  event({
    type: "response.completed",
    response: { output: [{ type: "message", content: "No image" }] },
  }),
  event({
    type: "response.output_item.done",
    item: { type: "image_generation_call", result: PNG },
  }),
  event({ type: "response.failed", response: { status: "failed" } }),
  event({ type: "response.incomplete", response: { status: "incomplete" } }),
])(
  "rejects unsupported, failed and truncated subscription image streams with no API fallback",
  async (stream) => {
    const fetch = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal("fetch", fetch);
    await expect(
      generateProviderImage(settings(), "lighthouse"),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  },
);
it("handles split SSE boundaries and completion-only image output", async () => {
  const text = event({
    type: "response.completed",
    response: { output: [{ type: "image_generation_call", result: PNG }] },
  });
  const encoder = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < text.length; i += 7)
              controller.enqueue(encoder.encode(text.slice(i, i + 7)));
            controller.close();
          },
        }),
      ),
    ),
  );
  expect(
    (await generateProviderImage(settings(), "lighthouse")).extension,
  ).toBe("png");
});
it("blocks direct GPT image API configuration even when paid use is acknowledged", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const config = settings();
  config.imageGeneration = {
    backend: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    providerId: "openai",
    model: "gpt-image-2",
    allowPaidRemote: true,
  };
  await expect(generateProviderImage(config, "lighthouse")).rejects.toThrow(
    "Configure an image backend",
  );
  expect(fetch).not.toHaveBeenCalled();
});
