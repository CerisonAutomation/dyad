/**
 * Auto-trigger for the self-improvement chat (surface B).
 *
 * The scheduler enqueues ONE run of the self-improvement chat when there is
 * something to do: the failure ledger has open entries AND the Dyad
 * repository is clean AND no turn for that chat is already running.
 *
 * The decision is a pure function ({@link shouldAutoTrigger}) so it can be
 * tested without a database, without git and without a chat stream. The
 * scheduler only supplies the state and performs the enqueue.
 *
 * The run is rate-limited: at most one run per
 * {@link AUTO_TRIGGER_MIN_INTERVAL_MS}. The slot is consumed by the ATTEMPT,
 * so a failing enqueue can never turn into a retry storm.
 */

import log from "electron-log";

import { loadLedger } from "./ledger";
import type { LedgerEntry } from "./types";

const logger = log.scope("self_heal_auto_trigger");

/** At most one run per this many milliseconds. */
export const AUTO_TRIGGER_MIN_INTERVAL_MS = 30 * 60 * 1000;

/** How often the scheduler looks at the state. */
export const AUTO_TRIGGER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** The state the trigger decides on. */
export interface AutoTriggerState {
  /** Whether the self-improvement chat exists. */
  chatAvailable: boolean;
  /** The open ledger signatures, most severe first. */
  openSignatures: string[];
  /** Whether the Dyad working tree is clean. */
  workingTreeClean: boolean;
  /** Whether a turn for the self-improvement chat is already running. */
  chatTurnActive: boolean;
  /** When the last run was enqueued. */
  lastRunAt?: number;
}

/** Why a run was refused. */
export type AutoTriggerRefusal =
  | "no-chat"
  | "no-open-entries"
  | "turn-active"
  | "dirty-working-tree"
  | "rate-limited";

/** The decision of the trigger. */
export type AutoTriggerDecision =
  | { run: true; reason: "ok" }
  | { run: false; reason: AutoTriggerRefusal };

/** The outcome of a trigger run, including the failures around it. */
export type AutoTriggerOutcome =
  | AutoTriggerDecision
  | {
      run: false;
      reason: "state-unavailable" | "enqueue-failed" | "already-running";
    };

/**
 * Decides whether a run of the self-improvement chat should be enqueued.
 *
 * The decision is pure: it reads the state and the clock, and it never
 * touches the database, git or the chat stream.
 */
export function shouldAutoTrigger(
  state: AutoTriggerState,
  now: number,
): AutoTriggerDecision {
  if (!state.chatAvailable) {
    return { run: false, reason: "no-chat" };
  }
  if (state.openSignatures.length === 0) {
    return { run: false, reason: "no-open-entries" };
  }
  if (state.chatTurnActive) {
    return { run: false, reason: "turn-active" };
  }
  if (!state.workingTreeClean) {
    return { run: false, reason: "dirty-working-tree" };
  }
  if (
    state.lastRunAt !== undefined &&
    now - state.lastRunAt < AUTO_TRIGGER_MIN_INTERVAL_MS
  ) {
    return { run: false, reason: "rate-limited" };
  }
  return { run: true, reason: "ok" };
}

/**
 * Picks the open failure classes out of a ledger, most severe first.
 *
 * Severity is the occurrence count first, then how recently the class was
 * seen.
 */
export function collectOpenSignatures(
  entries: Record<string, LedgerEntry>,
): string[] {
  return Object.values(entries ?? {})
    .filter((entry) => entry?.status === "open")
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return b.lastSeenAt - a.lastSeenAt;
    })
    .map((entry) => entry.signature);
}

/**
 * Reads the open failure classes of a workspace.
 *
 * A missing or unreadable ledger yields no open classes: the ledger is
 * evidence, never a hard dependency.
 */
export async function readOpenSignatures(appPath: string): Promise<string[]> {
  try {
    const ledger = await loadLedger(appPath);
    return collectOpenSignatures(ledger.entries);
  } catch (error) {
    logger.warn("Failed to read the failure ledger:", error);
    return [];
  }
}

/** The ports the scheduler needs. */
export interface AutoTriggerDeps {
  /** Reads the current state. Called once per tick. */
  getState(): Promise<Omit<AutoTriggerState, "lastRunAt">>;
  /** Enqueues one run of the self-improvement chat. */
  enqueueRun(context: { openSignatures: string[] }): Promise<void>;
  /** Reads the persisted timestamp of the last run. */
  loadLastRunAt?(): Promise<number | undefined>;
  /** Persists the timestamp of the last run. */
  saveLastRunAt?(timestamp: number): Promise<void>;
  /** The clock. Injectable for tests. */
  now?(): number;
}

/**
 * Runs the trigger once.
 *
 * Every failure around the decision is fail-safe: a state that cannot be
 * read, or an enqueue that fails, ends the run without throwing.
 */
export async function runAutoTrigger(
  deps: AutoTriggerDeps,
  now?: number,
): Promise<AutoTriggerOutcome> {
  const clock = now ?? deps.now?.() ?? Date.now();

  let state: Omit<AutoTriggerState, "lastRunAt">;
  try {
    state = await deps.getState();
  } catch (error) {
    logger.warn("Failed to read the auto-trigger state:", error);
    return { run: false, reason: "state-unavailable" };
  }

  let lastRunAt: number | undefined;
  try {
    lastRunAt = await deps.loadLastRunAt?.();
  } catch (error) {
    logger.warn("Failed to read the last auto-trigger run:", error);
    lastRunAt = undefined;
  }

  const decision = shouldAutoTrigger({ ...state, lastRunAt }, clock);
  if (!decision.run) {
    return decision;
  }

  // The slot is consumed by the ATTEMPT: a failing enqueue must not become a
  // retry storm on the next tick.
  try {
    await deps.saveLastRunAt?.(clock);
  } catch (error) {
    logger.warn("Failed to persist the last auto-trigger run:", error);
  }

  try {
    await deps.enqueueRun({ openSignatures: state.openSignatures });
  } catch (error) {
    logger.warn("Failed to enqueue the self-improvement run:", error);
    return { run: false, reason: "enqueue-failed" };
  }

  logger.info("Enqueued a self-improvement run", {
    openSignatures: state.openSignatures.length,
  });
  return decision;
}

/** The scheduler handle. */
export interface AutoTriggerScheduler {
  /** Runs the trigger once, immediately. */
  tick(): Promise<AutoTriggerOutcome>;
  /** Starts the periodic check. */
  start(): void;
  /** Stops the periodic check. */
  stop(): void;
}

/**
 * Creates the scheduler.
 *
 * The periodic check never overlaps with itself: a tick that is still
 * running is skipped.
 */
export function createAutoTriggerScheduler(
  deps: AutoTriggerDeps,
  options?: { intervalMs?: number },
): AutoTriggerScheduler {
  const intervalMs = options?.intervalMs ?? AUTO_TRIGGER_CHECK_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const tick = async (): Promise<AutoTriggerOutcome> => {
    if (running) {
      return { run: false, reason: "already-running" };
    }
    running = true;
    try {
      return await runAutoTrigger(deps);
    } finally {
      running = false;
    }
  };

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      // The scheduler must not keep the process alive on its own.
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
