import { afterEach, describe, expect, it, vi } from "vitest";

import { localImageGeneration } from "./local_image_generation";

describe("localImageGeneration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to a placeholder that carries the provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await localImageGeneration({ prompt: "a cat" });

    expect(result.provider).toBe("placeholder");
    expect(result.fallbackReason).toContain("network down");
    expect(result.url.startsWith("data:image/svg+xml")).toBe(true);
  });
});
