import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  AUTO_TRIGGER_MIN_INTERVAL_MS,
  collectOpenSignatures,
  createAutoTriggerScheduler,
  readOpenSignatures,
  runAutoTrigger,
  shouldAutoTrigger,
  type AutoTriggerDeps,
  type AutoTriggerState,
} from "./auto_trigger";
import type { LedgerEntry } from "./types";

const NOW = 1_700_000_000_000;

function makeState(
  overrides: Partial<AutoTriggerState> = {},
): AutoTriggerState {
  return {
    chatAvailable: true,
    openSignatures: ["read_file|NotFound|path:.ts|not found"],
    workingTreeClean: true,
    chatTurnActive: false,
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<LedgerEntry> & { signature: string },
): LedgerEntry {
  return {
    toolName: "read_file",
    errorKind: "NotFound",
    errorMessage: "not found",
    argKey: "path:.ts",
    occurrences: 1,
    firstSeenAt: 1,
    lastSeenAt: 1,
    status: "open",
    ...overrides,
  };
}

describe("shouldAutoTrigger", () => {
  it("runs when there is work, the tree is clean and no turn is active", () => {
    expect(shouldAutoTrigger(makeState(), NOW)).toEqual({
      run: true,
      reason: "ok",
    });
  });

  it("refuses when the chat does not exist", () => {
    expect(shouldAutoTrigger(makeState({ chatAvailable: false }), NOW)).toEqual(
      { run: false, reason: "no-chat" },
    );
  });

  it("refuses when the ledger has no open entries", () => {
    expect(shouldAutoTrigger(makeState({ openSignatures: [] }), NOW)).toEqual({
      run: false,
      reason: "no-open-entries",
    });
  });

  it("refuses while a turn for the chat is active", () => {
    expect(shouldAutoTrigger(makeState({ chatTurnActive: true }), NOW)).toEqual(
      { run: false, reason: "turn-active" },
    );
  });

  it("refuses when the working tree is dirty", () => {
    expect(
      shouldAutoTrigger(makeState({ workingTreeClean: false }), NOW),
    ).toEqual({ run: false, reason: "dirty-working-tree" });
  });

  it("refuses inside the rate-limit window", () => {
    expect(
      shouldAutoTrigger(
        makeState({ lastRunAt: NOW - AUTO_TRIGGER_MIN_INTERVAL_MS + 1 }),
        NOW,
      ),
    ).toEqual({ run: false, reason: "rate-limited" });
  });

  it("runs again once the rate-limit window has passed", () => {
    expect(
      shouldAutoTrigger(
        makeState({ lastRunAt: NOW - AUTO_TRIGGER_MIN_INTERVAL_MS }),
        NOW,
      ),
    ).toEqual({ run: true, reason: "ok" });
  });
});

describe("collectOpenSignatures", () => {
  it("keeps only the open classes, most severe first", () => {
    const entries = {
      a: makeEntry({ signature: "a", occurrences: 1, lastSeenAt: 10 }),
      b: makeEntry({ signature: "b", occurrences: 5, lastSeenAt: 1 }),
      c: makeEntry({ signature: "c", occurrences: 5, lastSeenAt: 20 }),
      d: makeEntry({ signature: "d", occurrences: 9, status: "handled" }),
      e: makeEntry({ signature: "e", occurrences: 9, status: "needs_human" }),
    };
    expect(collectOpenSignatures(entries)).toEqual(["c", "b", "a"]);
  });

  it("returns nothing for an empty ledger", () => {
    expect(collectOpenSignatures({})).toEqual([]);
  });
});

describe("readOpenSignatures", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-ledger-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads the open classes from the ledger", async () => {
    const ledgerDir = path.join(tempDir, ".dyad", "self-heal");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(
      path.join(ledgerDir, "ledger.json"),
      JSON.stringify({
        version: 1,
        entries: {
          a: makeEntry({ signature: "a" }),
          b: makeEntry({ signature: "b", status: "handled" }),
        },
      }),
    );
    expect(await readOpenSignatures(tempDir)).toEqual(["a"]);
  });

  it("returns nothing when there is no ledger", async () => {
    expect(await readOpenSignatures(tempDir)).toEqual([]);
  });
});

describe("runAutoTrigger", () => {
  it("enqueues a run when every gate passes", async () => {
    const enqueueRun = vi.fn(async () => {});
    const deps: AutoTriggerDeps = {
      getState: async () => makeState(),
      enqueueRun,
    };
    const outcome = await runAutoTrigger(deps, NOW);
    expect(outcome).toEqual({ run: true, reason: "ok" });
    expect(enqueueRun).toHaveBeenCalledWith({
      openSignatures: makeState().openSignatures,
    });
  });

  it("does not enqueue when the tree is dirty", async () => {
    const enqueueRun = vi.fn(async () => {});
    const deps: AutoTriggerDeps = {
      getState: async () => makeState({ workingTreeClean: false }),
      enqueueRun,
    };
    const outcome = await runAutoTrigger(deps, NOW);
    expect(outcome).toEqual({ run: false, reason: "dirty-working-tree" });
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("is rate limited by the persisted timestamp", async () => {
    const enqueueRun = vi.fn(async () => {});
    const deps: AutoTriggerDeps = {
      getState: async () => makeState(),
      enqueueRun,
      loadLastRunAt: async () => NOW - 60_000,
    };
    const outcome = await runAutoTrigger(deps, NOW);
    expect(outcome).toEqual({ run: false, reason: "rate-limited" });
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("persists the timestamp of the run", async () => {
    const saveLastRunAt = vi.fn(async () => {});
    const deps: AutoTriggerDeps = {
      getState: async () => makeState(),
      enqueueRun: async () => {},
      saveLastRunAt,
    };
    await runAutoTrigger(deps, NOW);
    expect(saveLastRunAt).toHaveBeenCalledWith(NOW);
  });

  it("consumes the slot even when the enqueue fails", async () => {
    const saveLastRunAt = vi.fn(async () => {});
    const deps: AutoTriggerDeps = {
      getState: async () => makeState(),
      enqueueRun: async () => {
        throw new Error("boom");
      },
      saveLastRunAt,
    };
    const outcome = await runAutoTrigger(deps, NOW);
    expect(outcome).toEqual({ run: false, reason: "enqueue-failed" });
    expect(saveLastRunAt).toHaveBeenCalledWith(NOW);
  });

  it("survives a state that cannot be read", async () => {
    const deps: AutoTriggerDeps = {
      getState: async () => {
        throw new Error("no database");
      },
      enqueueRun: async () => {},
    };
    const outcome = await runAutoTrigger(deps, NOW);
    expect(outcome).toEqual({ run: false, reason: "state-unavailable" });
  });
});

describe("createAutoTriggerScheduler", () => {
  it("runs the trigger on a tick and stops cleanly", async () => {
    const enqueueRun = vi.fn(async () => {});
    const deps: AutoTriggerDeps = {
      getState: async () => makeState(),
      enqueueRun,
    };
    const scheduler = createAutoTriggerScheduler(deps, { intervalMs: 10_000 });
    const outcome = await scheduler.tick();
    expect(outcome).toEqual({ run: true, reason: "ok" });
    expect(enqueueRun).toHaveBeenCalledTimes(1);

    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
  });

  it("never overlaps with itself", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: AutoTriggerDeps = {
      getState: async () => {
        await gate;
        return makeState();
      },
      enqueueRun: async () => {},
    };
    const scheduler = createAutoTriggerScheduler(deps);
    const first = scheduler.tick();
    const second = await scheduler.tick();
    expect(second).toEqual({ run: false, reason: "already-running" });
    release?.();
    await first;
  });
});
