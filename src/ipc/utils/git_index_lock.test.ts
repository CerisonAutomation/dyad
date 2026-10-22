import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import { gitAdd } from "@/ipc/utils/git_utils";

const execFileAsync = promisify(execFile);

async function runGit(repoDir: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repoDir });
}

describe("git index lock recovery", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    if (repoDir) {
      await fs.promises.rm(repoDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      repoDir = undefined;
    }
  });

  async function createRepo(): Promise<string> {
    repoDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-index-lock-"),
    );
    await runGit(repoDir, ["init"]);
    await fs.promises.writeFile(path.join(repoDir, "file.txt"), "content\n");
    return repoDir;
  }

  function lockPath(repo: string): string {
    return path.join(repo, ".git", "index.lock");
  }

  it("recovers a stale index lock and stages the file", async () => {
    const repo = await createRepo();
    const lock = lockPath(repo);
    await fs.promises.writeFile(lock, "");
    const staleSecondsAgo = new Date(Date.now() - 10 * 60 * 1000);
    await fs.promises.utimes(lock, staleSecondsAgo, staleSecondsAgo);

    await gitAdd({ path: repo, filepath: "file.txt" });

    expect(fs.existsSync(lock)).toBe(false);
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--cached", "--name-only"],
      {
        cwd: repo,
      },
    );
    expect(stdout.trim()).toBe("file.txt");
  });

  it("keeps a fresh index lock and reports an actionable error", async () => {
    const repo = await createRepo();
    const lock = lockPath(repo);
    await fs.promises.writeFile(lock, "");

    await expect(gitAdd({ path: repo, filepath: "file.txt" })).rejects.toThrow(
      /Another git process is using this repository's index/,
    );

    expect(fs.existsSync(lock)).toBe(true);
  });
});
