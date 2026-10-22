import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  localImageGeneration: vi.fn(),
}));

vi.mock("./local_image_generation", () => ({
  localImageGeneration: mocks.localImageGeneration,
}));

import { generateImageTool } from "./generate_image";

const tempDirs: string[] = [];

async function makeAppPath(): Promise<string> {
  const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-image-"));
  tempDirs.push(appPath);
  return appPath;
}

function makeCtx(appPath: string): AgentContext {
  return {
    appId: 1,
    appPath,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext;
}

describe("generateImageTool", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("names the saved file after the payload media type", async () => {
    const appPath = await makeAppPath();
    mocks.localImageGeneration.mockResolvedValue({
      url: "data:image/svg+xml;base64,PHN2Zy8+",
      prompt: "a cat",
      provider: "placeholder",
      width: 1024,
      height: 1024,
    });

    const result = await generateImageTool.execute(
      { prompt: "a cat" },
      makeCtx(appPath),
    );

    expect(result).toContain(".svg");
    expect(result).not.toContain(".png");
  });

  it("reports a placeholder image as a placeholder", async () => {
    const appPath = await makeAppPath();
    mocks.localImageGeneration.mockResolvedValue({
      url: "data:image/svg+xml;base64,PHN2Zy8+",
      prompt: "a cat",
      provider: "placeholder",
      width: 1024,
      height: 1024,
      fallbackReason: "Pollinations.ai returned 503",
    });

    const result = await generateImageTool.execute(
      { prompt: "a cat" },
      makeCtx(appPath),
    );

    expect(result).toContain("Placeholder image");
    expect(result).toContain("NOT a real generated image");
    expect(result).toContain("Pollinations.ai returned 503");
    // A placeholder is not a generated asset, so it must not count as a
    // completed mutation.
    expect(
      generateImageTool.shouldTrackMutation?.(
        { prompt: "a cat" },
        result,
        makeCtx(appPath),
      ),
    ).toBe(false);
  });
});
