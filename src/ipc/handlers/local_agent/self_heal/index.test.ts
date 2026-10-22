import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({
  scope: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: (...args: unknown[]) => logMocks.scope(...(args as [])),
  },
}));

import {
  assertSelfHealScope,
  buildArchitectDesignerPrompt,
  buildPreventionPromptBlock,
  buildSelfHealInstruction,
  decideScore,
  decideYesNo,
  recordToolFailure,
  type PreventionRule,
} from "./index";

// Compile-time proof that the public API keeps the shape other work depends
// on. A change to a signature breaks this file, not the caller.
const _recordToolFailure: (params: {
  appPath: string;
  toolName: string;
  args: unknown;
  error: unknown;
  alreadyHandled: Set<string>;
}) => Promise<{ signature: string; instruction: string } | undefined> =
  recordToolFailure;
const _buildPreventionPromptBlock: (appPath: string) => Promise<string> =
  buildPreventionPromptBlock;
const _buildSelfHealInstruction: (signature: string) => string =
  buildSelfHealInstruction;
const _decideYesNo: (
  input: string,
  options?: { timeoutMs?: number },
) => Promise<{ ok: boolean; score: number; unavailable: boolean }> =
  decideYesNo;
const _decideScore: (
  input: string,
  options?: { timeoutMs?: number },
) => Promise<{ score: number; unavailable: boolean }> = decideScore;
const _assertSelfHealScope: (dyadRoot: string, targetPath: string) => void =
  assertSelfHealScope;
const _buildArchitectDesignerPrompt: (options: {
  appPath: string;
  preventionRules: PreventionRule[];
}) => string = buildArchitectDesignerPrompt;

const tempDirs: string[] = [];

async function makeAppPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-self-heal-api-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("public API", () => {
  it("exposes every function the module promises", () => {
    for (const fn of [
      _recordToolFailure,
      _buildPreventionPromptBlock,
      _buildSelfHealInstruction,
      _decideYesNo,
      _decideScore,
      _assertSelfHealScope,
      _buildArchitectDesignerPrompt,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("records a failure and hands back the instruction once", async () => {
    const appPath = await makeAppPath();
    const handled = new Set<string>();
    const first = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: handled,
    });
    expect(first?.instruction).toBe(
      buildSelfHealInstruction(first?.signature ?? ""),
    );
    await expect(
      recordToolFailure({
        appPath,
        toolName: "read_file",
        args: { path: "src/a.ts" },
        error: new Error("boom"),
        alreadyHandled: handled,
      }),
    ).resolves.toBeUndefined();
  });

  it("renders an empty prevention block when there is nothing to inject", async () => {
    const appPath = await makeAppPath();
    await expect(buildPreventionPromptBlock(appPath)).resolves.toBe("");
  });
});
