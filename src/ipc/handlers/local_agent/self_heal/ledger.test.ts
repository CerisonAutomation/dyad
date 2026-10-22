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

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  capLedger,
  computeFailureSignature,
  deriveArgKey,
  getLedgerPath,
  loadLedger,
  normaliseErrorMessage,
  recordToolFailure,
} from "./ledger";
import type { LedgerEntry, LedgerFile } from "./types";

const tempDirs: string[] = [];

async function makeAppPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-self-heal-"));
  tempDirs.push(dir);
  return dir;
}

function makeEntry(signature: string, lastSeenAt: number): LedgerEntry {
  return {
    signature,
    toolName: "read_file",
    errorKind: "not_found",
    errorMessage: "boom",
    argKey: "path:.ts",
    occurrences: 1,
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    status: "open",
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("normaliseErrorMessage", () => {
  it("collapses absolute and relative paths onto one placeholder", () => {
    const a = normaliseErrorMessage(
      "File does not exist: /Users/me/app/src/lib/backend/supabase.ts",
    );
    const b = normaliseErrorMessage(
      "File does not exist: src/lib/backend/supabase.ts",
    );
    expect(a).toBe(b);
    expect(a).toContain("<path>");
  });

  it("strips ids, numbers, hex and quoted values", () => {
    const normalized = normaliseErrorMessage(
      'Request 42a9f0b1-1111-2222-3333-444455556666 failed with 0xDEADBEEF and "secret-value" at line 17',
    );
    expect(normalized).toContain("<id>");
    expect(normalized).toContain("<hex>");
    expect(normalized).toContain("<value>");
    expect(normalized).toContain("<n>");
    expect(normalized).not.toContain("42a9f0b1");
    expect(normalized).not.toContain("secret-value");
  });

  it("does not treat a plain relative word as a path", () => {
    expect(normaliseErrorMessage("npm run lint failed")).toBe(
      "npm run lint failed",
    );
  });
});

describe("deriveArgKey", () => {
  it("uses the file extension for file-shaped tools", () => {
    expect(deriveArgKey("read_file", { path: "src/a/b.ts" })).toBe("path:.ts");
    expect(deriveArgKey("write_file", { filePath: "src/a/b.TSX" })).toBe(
      "path:.tsx",
    );
  });

  it("falls back to the tool name", () => {
    expect(deriveArgKey("run_shell", { command: "ls" })).toBe("tool:run_shell");
    expect(deriveArgKey("read_file", undefined)).toBe("tool:read_file");
  });
});

describe("computeFailureSignature", () => {
  it("gives the same signature for the same class with a different path", () => {
    const first = computeFailureSignature({
      toolName: "read_file",
      args: { path: "src/lib/a.ts" },
      error: new Error("File does not exist: src/lib/a.ts"),
    });
    const second = computeFailureSignature({
      toolName: "read_file",
      args: { path: "src/other/b.ts" },
      error: new Error("File does not exist: src/other/b.ts"),
    });
    expect(first).toBe(second);
  });

  it("separates different tools and different error kinds", () => {
    const base = computeFailureSignature({
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
    });
    const otherTool = computeFailureSignature({
      toolName: "write_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
    });
    const otherKind = computeFailureSignature({
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new DyadError("boom", DyadErrorKind.NotFound),
    });
    expect(base).not.toBe(otherTool);
    expect(base).not.toBe(otherKind);
    expect(otherKind).toContain("not_found");
  });
});

describe("recordToolFailure", () => {
  it("returns the instruction for a new failure class only once", async () => {
    const appPath = await makeAppPath();
    const alreadyHandled = new Set<string>();

    const first = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("File does not exist: src/a.ts"),
      alreadyHandled,
    });
    expect(first?.instruction).toContain("dyad-self-heal");
    expect(first?.signature).toBeTruthy();
    expect(alreadyHandled.has(first!.signature)).toBe(true);

    const second = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("File does not exist: src/a.ts"),
      alreadyHandled,
    });
    expect(second).toBeUndefined();
  });

  it("does not re-inject a class that was already handled in an earlier turn", async () => {
    const appPath = await makeAppPath();
    const firstTurn = new Set<string>();
    await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: firstTurn,
    });

    const secondTurn = new Set<string>();
    const result = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: secondTurn,
    });
    expect(result).toBeUndefined();
  });

  it("skips user cancellations", async () => {
    const appPath = await makeAppPath();
    const result = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new DyadError("nope", DyadErrorKind.UserCancelled),
      alreadyHandled: new Set<string>(),
    });
    expect(result).toBeUndefined();
    const ledger = await loadLedger(appPath);
    expect(Object.keys(ledger.entries)).toHaveLength(0);
  });

  it("records occurrences for a recurring class", async () => {
    const appPath = await makeAppPath();
    const handled = new Set<string>();
    await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: handled,
    });
    await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: handled,
    });
    const ledger = await loadLedger(appPath);
    const entries = Object.values(ledger.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0].occurrences).toBe(2);
    expect(entries[0].status).toBe("open");
  });

  it("never throws when the ledger cannot be written", async () => {
    const appPath = await makeAppPath();
    // A file where the .dyad directory should be makes every write fail.
    await fs.writeFile(path.join(appPath, ".dyad"), "not a dir");
    const handled = new Set<string>();
    await expect(
      recordToolFailure({
        appPath,
        toolName: "read_file",
        args: { path: "src/a.ts" },
        error: new Error("boom"),
        alreadyHandled: handled,
      }),
    ).resolves.toBeDefined();
  });

  it("writes the ledger under .dyad/self-heal", async () => {
    const appPath = await makeAppPath();
    await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: new Set<string>(),
    });
    const ledgerPath = getLedgerPath(appPath);
    expect(ledgerPath).toBe(
      path.join(appPath, ".dyad", "self-heal", "ledger.json"),
    );
    const raw = JSON.parse(await fs.readFile(ledgerPath, "utf-8"));
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.entries)).toHaveLength(1);
  });
});

describe("capLedger", () => {
  it("keeps the most recently seen entries", () => {
    const entries: Record<string, LedgerEntry> = {};
    for (let index = 0; index < 250; index++) {
      const signature = `sig-${index}`;
      entries[signature] = makeEntry(signature, index);
    }
    const capped = capLedger({ version: 1, entries });
    const kept = Object.values(capped.entries);
    expect(kept).toHaveLength(200);
    expect(capped.entries["sig-249"]).toBeDefined();
    expect(capped.entries["sig-0"]).toBeUndefined();
  });

  it("leaves a small ledger untouched", () => {
    const ledger: LedgerFile = {
      version: 1,
      entries: { "sig-1": makeEntry("sig-1", 1) },
    };
    expect(capLedger(ledger)).toBe(ledger);
  });
});
