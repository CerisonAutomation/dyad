// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import type { UserSettings } from "@/lib/schemas";
import {
  generateProviderImage,
  isProviderImageGenerationConfigured,
  validateGeneratedImage,
} from "./provider_image_generation";
import { ImageGenerationSettingsSchema } from "@/shared/image_generation_config";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const configured = (patch = {}) =>
  ({
    providerSettings: { images: { apiKey: { value: "fixture-token" } } },
    imageGeneration: {
      backend: "cloudflare",
      providerId: "images",
      model: "@cf/example/model",
      accountId: "a".repeat(32),
      allowPaidRemote: false,
      ...patch,
    },
  }) as unknown as UserSettings;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("requires explicit configuration rather than commercial entitlement or chat credentials", () => {
  expect(
    isProviderImageGenerationConfigured({
      providerSettings: { auto: { apiKey: { value: "old" } } },
    } as unknown as UserSettings),
  ).toBe(false);
  expect(isProviderImageGenerationConfigured(configured())).toBe(true);
});
it("uses the configured Cloudflare model/account/token without a paid fallback", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: { image: PNG } })),
    );
  vi.stubGlobal("fetch", fetch);
  const image = await generateProviderImage(configured(), "lighthouse");
  expect(image.extension).toBe("png");
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/@cf/example/model`,
  );
  expect(init.redirect).toBe("error");
  expect(JSON.parse(init.body)).toEqual({ prompt: "lighthouse" });
  expect(init.headers.Authorization).toBe("Bearer fixture-token");
});
it.each([401, 403, 429, 500])(
  "fails HTTP %s without leaking response data or retrying",
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("fixture-token private-provider-error", { status }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      generateProviderImage(configured(), "lighthouse"),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledOnce();
  },
);
it("rejects oversized/invalid data, SVG and pixel bombs", async () => {
  expect(() =>
    validateGeneratedImage(Buffer.from("<svg><script/></svg>")),
  ).toThrow("invalid/unsupported");
  const bytes = Buffer.from(PNG, "base64");
  bytes.writeUInt32BE(200000, 16);
  bytes.writeUInt32BE(200000, 20);
  expect(() => validateGeneratedImage(bytes)).toThrow("dimensions");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { image: "invalid base64!" },
        }),
      ),
    ),
  );
  await expect(
    generateProviderImage(configured(), "lighthouse"),
  ).rejects.toThrow("base64");
});
it("requires explicit paid-remote authorization and rejects unsafe endpoints", () => {
  for (const baseUrl of [
    "http://example.com/v1",
    "https://token@example.com/v1",
    "https://example.com/v1?token=secret",
  ])
    expect(
      ImageGenerationSettingsSchema.safeParse({
        backend: "openai-compatible",
        model: "chosen",
        providerId: "images",
        baseUrl,
        allowPaidRemote: true,
      }).success,
    ).toBe(false);
  expect(
    isProviderImageGenerationConfigured(
      configured({
        backend: "openai-compatible",
        baseUrl: "https://image-provider.example/v1",
        allowPaidRemote: false,
      }),
    ),
  ).toBe(false);
});
it("rejects response-provided cross-origin image downloads", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: "http://169.254.169.254/private" }] }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateProviderImage(
      configured({
        backend: "openai-compatible",
        baseUrl: "https://example.com/v1",
        model: "chosen",
        allowPaidRemote: true,
      }),
      "lighthouse",
    ),
  ).rejects.toThrow("configured provider origin");
  expect(fetch).toHaveBeenCalledOnce();
});
it("does not make requests after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateProviderImage(configured(), "x", controller.signal),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("performs a real HTTP request against an explicitly configured local protocol fixture", async () => {
  const requests: { url?: string; authorization?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body,
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const settings = configured({
      backend: "openai-compatible",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "user-selected-image-model",
    });
    settings.providerSettings = {};
    const image = await generateProviderImage(settings, "fixture lighthouse");
    expect(image.extension).toBe("png");
    expect(image.bytes.equals(Buffer.from(PNG, "base64"))).toBe(true);
    expect(requests).toEqual([
      {
        url: "/v1/images/generations",
        authorization: undefined,
        body: JSON.stringify({
          prompt: "fixture lighthouse",
          model: "user-selected-image-model",
          n: 1,
        }),
      },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("supports an explicitly selected multipart model without pinning its identity or setting its boundary", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ result: { image: PNG } })),
    );
  vi.stubGlobal("fetch", fetch);
  await generateProviderImage(
    configured({
      model: "@cf/user/chosen-image-model",
      requestFormat: "multipart",
      width: 768,
      height: 512,
    }),
    "landscape",
  );
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toContain("@cf/user/chosen-image-model");
  expect(init.body).toBeInstanceOf(FormData);
  expect(init.body.get("prompt")).toBe("landscape");
  expect(init.body.get("width")).toBe("768");
  expect(init.body.get("height")).toBe("512");
  expect(init.headers).not.toHaveProperty("Content-Type");
});
it("preserves real JPEG/WebP encodings instead of mislabeling Cloudflare output as PNG", async () => {
  const { default: fixtures } =
    await import("@/testing/fixtures/tiny-raster-images.json");
  for (const [type, base64] of Object.entries(fixtures)) {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: { image: base64 } })),
        ),
    );
    const image = await generateProviderImage(configured(), "tiny raster");
    expect(image.extension).toBe(type === "jpeg" ? "jpg" : type);
  }
});
it("supports bounded binary image responses from Cloudflare models", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(Buffer.from(PNG, "base64"), {
        headers: { "content-type": "image/png" },
      }),
    ),
  );
  expect(
    (await generateProviderImage(configured(), "tiny raster")).extension,
  ).toBe("png");
});
it("bounds declared and streaming response sizes before decoding JSON", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("small", {
        headers: { "content-length": String(25 * 1024 * 1024) },
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(25 * 1024 * 1024));
            controller.close();
          },
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  for (let i = 0; i < 2; i++)
    await expect(
      generateProviderImage(configured(), "tiny raster"),
    ).rejects.toThrow("maximum allowed size");
});
it("interrupts a stalled response body when the caller cancels", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const bodyStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      new ReadableStream({
        pull() {
          started();
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = generateProviderImage(
    configured(),
    "tiny raster",
    controller.signal,
  );
  await bodyStarted;
  controller.abort();
  await expect(result).rejects.toMatchObject({ kind: "user_cancelled" });
});
