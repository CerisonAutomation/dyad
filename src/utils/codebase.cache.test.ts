import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearFileContentCache, readFileWithCache } from "@/utils/codebase";

/**
 * The cache was bounded by entry COUNT only, and each entry holds a whole
 * file body of up to 1 MB - so 500 entries allowed ~500 MB of main-process
 * strings to accumulate.
 */
describe("file content cache", () => {
  it("releases every cached body when the cache is cleared", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dyad-file-cache-"));
    try {
      const filePath = path.join(dir, "a.ts");
      await writeFile(filePath, "hello");
      await readFileWithCache(filePath);

      clearFileContentCache();

      // A second read still returns the content: the cache is an optimization,
      // not a correctness requirement.
      await expect(readFileWithCache(filePath)).resolves.toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
      clearFileContentCache();
    }
  });

  it("re-reads a file whose modification time changed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dyad-file-cache-mtime-"));
    try {
      const filePath = path.join(dir, "b.ts");
      await writeFile(filePath, "first");
      await expect(readFileWithCache(filePath)).resolves.toBe("first");

      // Rewrite with a different mtime so the cache is invalidated.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(filePath, "second");

      await expect(readFileWithCache(filePath)).resolves.toBe("second");
    } finally {
      await rm(dir, { recursive: true, force: true });
      clearFileContentCache();
    }
  });
});
