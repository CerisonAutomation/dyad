import * as nodeChildProcess from "node:child_process";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import pathModule from "node:path";
import log from "electron-log";

const logger = log.scope("git_index_lock");

/**
 * How old a git index lock must be before it is treated as a leftover from a
 * crashed or killed git process.
 *
 * A live git process holds `.git/index.lock` only for the duration of a
 * single index write, which is orders of magnitude shorter than a minute. A
 * lock that is still around after a minute is, with overwhelming likelihood,
 * the residue of a process that died mid-write.
 */
export const STALE_INDEX_LOCK_MIN_AGE_MS = 60_000;

/**
 * The result of inspecting a repository's index lock.
 *
 * - `recovered`: the lock was stale and has been removed.
 * - `not-stale`: the lock is too young to be stale, or it disappeared.
 * - `held-by-live-process`: a live process still has the lock open.
 * - `indeterminate`: the lock could not be judged safely; it was left alone.
 */
export type IndexLockRecovery =
  | "recovered"
  | "not-stale"
  | "held-by-live-process"
  | "indeterminate";

/**
 * Git reports a contended index as
 * `fatal: Unable to create '<repo>/.git/index.lock': File exists.`
 * Match on the lock name plus the existence wording so that unrelated
 * failures (permissions, missing repository) never trigger a recovery.
 */
export function isIndexLockConflict(text: string): boolean {
  return (
    /index\.lock/i.test(text) &&
    /(file exists|already exists|file is exist)/i.test(text)
  );
}

/** The user-facing explanation for a lock that must not be removed. */
export function indexLockConflictMessage(lockPath: string | undefined): string {
  const location = lockPath ? ` (${lockPath})` : "";
  return (
    `Another git process is using this repository's index${location}. ` +
    "Wait for it to finish and retry. If no git process is running, " +
    "delete the index.lock file and retry."
  );
}

type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number },
  callback: (
    error: (Error & { code?: string | number }) | null,
    stdout: string,
    stderr: string,
  ) => void,
) => void;

/**
 * `execFile` is resolved lazily and defensively: test harnesses routinely
 * replace `node:child_process` with a partial mock, and this module must
 * never break their import graph. A missing `execFile` only means the holder
 * probe cannot run, which makes the lock indeterminate (and therefore
 * untouchable).
 */
function readExecFile(): ExecFileLike | undefined {
  try {
    const candidate = (nodeChildProcess as { execFile?: unknown }).execFile;
    return typeof candidate === "function"
      ? (candidate as ExecFileLike)
      : undefined;
  } catch {
    return undefined;
  }
}

async function findLsofHolders(
  lockPath: string,
): Promise<string[] | undefined> {
  const execFile = readExecFile();
  if (!execFile) {
    return undefined;
  }
  const result = await new Promise<{
    error: (Error & { code?: string | number }) | null;
    stdout: string;
  }>((resolve) => {
    try {
      execFile(
        "lsof",
        ["-Fpn", "--", lockPath],
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
        (error, stdout) => resolve({ error, stdout }),
      );
    } catch (error) {
      resolve({ error: error as Error, stdout: "" });
    }
  });
  if (!result.error) {
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("p"))
      .map((line) => line.slice(1).trim())
      .filter((pid) => pid.length > 0);
  }
  const code = result.error.code;
  // lsof exits with 1 when it simply found nothing; that is a definitive
  // "no holder". A missing lsof binary (ENOENT) or any other failure means
  // the question cannot be answered.
  if (code === "ENOENT") return undefined;
  if (code === 1 || code === "1") return [];
  return undefined;
}

async function findProcFdHolders(
  lockPath: string,
): Promise<string[] | undefined> {
  let entries: string[];
  try {
    entries = await fsPromises.readdir("/proc");
  } catch {
    return undefined;
  }
  const holders: string[] = [];
  let inspected = 0;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    inspected += 1;
    let descriptors: string[];
    try {
      descriptors = await fsPromises.readdir(
        pathModule.join("/proc", entry, "fd"),
      );
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      try {
        const target = await fsPromises.readlink(
          pathModule.join("/proc", entry, "fd", descriptor),
        );
        if (target === lockPath) {
          holders.push(entry);
          break;
        }
      } catch {
        continue;
      }
    }
  }
  if (inspected === 0) {
    return undefined;
  }
  return holders;
}

/**
 * Whether any live process currently holds the index lock open.
 *
 * Returns `undefined` when the platform cannot answer the question. Callers
 * must then treat the lock as live and leave it in place: removing a lock a
 * live git process owns would corrupt the index it is writing.
 */
async function findLiveLockHolders(
  lockPath: string,
): Promise<string[] | undefined> {
  if (process.platform === "win32") {
    // Windows has no portable way to ask "who holds this file open" without
    // extra tooling, so the lock is treated as live.
    return undefined;
  }
  const lsofHolders = await findLsofHolders(lockPath);
  if (lsofHolders !== undefined) {
    return lsofHolders;
  }
  if (process.platform === "linux") {
    return findProcFdHolders(lockPath);
  }
  return undefined;
}

/**
 * Removes a repository's index lock when it is provably stale, and only then.
 *
 * A lock is stale when it is a regular file, older than `minAgeMs`, and no
 * live process has it open. Anything else is left untouched.
 */
export async function recoverStaleIndexLock(options: {
  readonly lockPath: string;
  readonly minAgeMs?: number;
  readonly now?: number;
}): Promise<IndexLockRecovery> {
  const minAgeMs = options.minAgeMs ?? STALE_INDEX_LOCK_MIN_AGE_MS;
  const now = options.now ?? Date.now();

  let stats: fs.Stats;
  try {
    stats = await fsPromises.lstat(options.lockPath);
  } catch {
    // The lock disappeared on its own; nothing to recover.
    return "not-stale";
  }
  if (!stats.isFile()) {
    // A symlink or directory named index.lock is never a git lock; refuse to
    // touch it.
    return "indeterminate";
  }
  const ageMs = now - stats.mtimeMs;
  if (ageMs < minAgeMs) {
    return "not-stale";
  }

  const holders = await findLiveLockHolders(options.lockPath);
  if (holders === undefined) {
    logger.warn(
      `Could not determine whether ${options.lockPath} is held by a live process; leaving it in place`,
    );
    return "indeterminate";
  }
  if (holders.length > 0) {
    logger.warn(
      `Leaving ${options.lockPath} in place: still held by process(es) ${holders.join(", ")}`,
    );
    return "held-by-live-process";
  }

  try {
    await fsPromises.unlink(options.lockPath);
  } catch (error) {
    logger.warn(
      `Failed to remove stale git index lock ${options.lockPath}`,
      error,
    );
    return "indeterminate";
  }
  logger.warn(
    `Removed stale git index lock ${options.lockPath} (${Math.round(ageMs / 1000)}s old)`,
  );
  return "recovered";
}
