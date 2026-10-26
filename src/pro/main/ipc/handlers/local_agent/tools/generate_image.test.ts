import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateImageTool } from "./generate_image";
import type { AgentContext } from "./types";
import type { UserSettings } from "@/lib/schemas";
const state = vi.hoisted(() => ({ settings: {} as unknown }));
vi.mock("@/main/settings", () => ({ readSettings: () => state.settings }));
const configured = () =>
  ({
    providerSettings: { images: { apiKey: { value: "fixture-token" } } },
    imageGeneration: {
      backend: "cloudflare",
      providerId: "images",
      model: "@cf/test/user-choice",
      accountId: "a".repeat(32),
      allowPaidRemote: false,
    },
  }) as unknown as UserSettings;
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent2-image-tool-"));
  state.settings = configured();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(directory, { recursive: true, force: true });
});
function context(): AgentContext {
  return {
    appPath: directory,
    isDyadPro: false,
    inferenceSettings: configured(),
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext;
}
it("is available to configured BYOK turns without commercial entitlement and still asks consent", () => {
  expect(generateImageTool.usesEngineEndpoint).toBe(false);
  expect(generateImageTool.defaultConsent).toBe("ask");
  expect(generateImageTool.isEnabled?.(context())).toBe(true);
});
it("honors chat-scoped image configuration instead of an unrelated global key", () => {
  const ctx = context();
  ctx.inferenceSettings = { providerSettings: {} } as unknown as UserSettings;
  expect(generateImageTool.isEnabled?.(ctx)).toBe(false);
});
it("saves a real JPEG using its actual extension and emits the saved relative path", async () => {
  const { default: fixtures } =
    await import("@/testing/fixtures/tiny-raster-images.json");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ result: { image: fixtures.jpeg } })),
      ),
  );
  const ctx = context();
  const result = await generateImageTool.execute(
    { prompt: 'a "tiny" lighthouse' },
    ctx,
  );
  expect(result).toMatch(/\.dyad[/\\]media[/\\]generated-.*\.jpg/);
  const names = await fs.readdir(path.join(directory, ".dyad/media"));
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/\.jpg$/);
  expect(
    (await fs.readFile(path.join(directory, ".dyad/media", names[0]))).equals(
      Buffer.from(fixtures.jpeg, "base64"),
    ),
  ).toBe(true);
  expect(ctx.onXmlComplete).toHaveBeenCalledWith(
    expect.stringContaining("&quot;tiny&quot;"),
  );
});
it("does not create a file when generation is cancelled before admission", async () => {
  const ctx = context();
  const controller = new AbortController();
  controller.abort();
  ctx.abortSignal = controller.signal;
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateImageTool.execute({ prompt: "tiny" }, ctx),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).toEqual([]);
});

it.skipIf(process.platform === "win32").each([".dyad", ".dyad/media"])(
  "refuses to save through a managed-directory symlink: %s",
  async (target) => {
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent2-image-outside-"),
    );
    try {
      const fixtures =
        await import("@/testing/fixtures/tiny-raster-images.json");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ result: { image: fixtures.default.jpeg } }),
            ),
          ),
      );
      if (target === ".dyad/media")
        await fs.mkdir(path.join(directory, ".dyad"));
      await fs.symlink(outside, path.join(directory, target), "dir");
      await expect(
        generateImageTool.execute({ prompt: "tiny" }, context()),
      ).rejects.toThrow("symbolic links");
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  },
);
