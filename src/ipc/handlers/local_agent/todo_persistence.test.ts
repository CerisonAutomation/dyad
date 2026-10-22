import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadTodos, saveTodos } from "./todo_persistence";

const tempDirs: string[] = [];

async function makeAppPath(): Promise<string> {
  const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-todos-"));
  tempDirs.push(appPath);
  return appPath;
}

describe("saveTodos", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("persists todos that can be loaded again", async () => {
    const appPath = await makeAppPath();

    await saveTodos(appPath, 7, [
      { id: "a", content: "First", status: "pending" },
    ]);

    await expect(loadTodos(appPath, 7)).resolves.toEqual([
      { id: "a", content: "First", status: "pending" },
    ]);
  });

  it("fails loudly when the todos file cannot be written", async () => {
    const appPath = await makeAppPath();
    // A file where the todos directory should be makes the write fail.
    await fs.mkdir(path.join(appPath, ".dyad"), { recursive: true });
    await fs.writeFile(path.join(appPath, ".dyad", "todos"), "not a dir");

    await expect(
      saveTodos(appPath, 7, [{ id: "a", content: "First", status: "pending" }]),
    ).rejects.toMatchObject({ kind: "internal" });
  });
});
