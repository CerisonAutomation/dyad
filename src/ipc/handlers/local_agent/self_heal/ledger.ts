/**
 * Failure ledger.
 *
 * Records every failing tool call as a *failure class* (not an instance) so
 * the same bug seen through a different path, id or number collapses into one
 * entry. The ledger lives at `<appPath>/.dyad/self-heal/ledger.json` and is
 * capped (LRU by `lastSeenAt`) so it can never grow without bound.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { buildSelfHealInstruction } from "./instruction";
import type { LedgerEntry, LedgerFile, LedgerStatus } from "./types";

const logger = log.scope("self_heal_ledger");

/** Maximum number of ledger entries kept on disk (LRU by `lastSeenAt`). */
export const LEDGER_MAX_ENTRIES = 200;

/** Maximum length of the stored raw error message. */
const ERROR_MESSAGE_MAX_LENGTH = 500;

/** Maximum length of the normalised message that feeds the signature. */
const NORMALIZED_MESSAGE_MAX_LENGTH = 120;

/** Argument names that carry a file path for file-shaped tools. */
const FILE_PATH_ARG_KEYS = [
  "path",
  "filePath",
  "file_path",
  "absolutePath",
  "targetPath",
  "file",
] as const;

const QUOTED_RE = /'[^']*'|"[^"]*"|`[^`]*`/g;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_RE = /\b0x[0-9a-f]+\b/gi;
const LONG_HEX_RE = /\b[0-9a-f]{12,}\b/gi;
// Absolute POSIX / Windows paths. The lookbehind keeps "src/lib" from being
// read as "/lib".
const ABSOLUTE_PATH_RE = /(?<![\w@.-])(?:[A-Za-z]:)?(?:\/[\w.@+~-]+)+\/?/g;
// Relative paths with at least one separator.
const RELATIVE_PATH_RE = /[\w.@+~-]+(?:\/[\w.@+~-]+)+/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

/** Path of the ledger file for an app. */
export function getLedgerPath(appPath: string): string {
  return path.join(appPath, ".dyad", "self-heal", "ledger.json");
}

function isUserCancellation(error: unknown): boolean {
  return isDyadError(error) && error.kind === DyadErrorKind.UserCancelled;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function extractErrorKind(error: unknown): string {
  return isDyadError(error) ? error.kind : "unknown";
}

function findFilePathArg(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  for (const key of FILE_PATH_ARG_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The stable shape of a file path: its lowercased extension.
 *
 * Using the extension rather than the full path keeps the argument key
 * low-cardinality, so the same bug seen on a different file still lands in
 * the same failure class.
 */
function fileExtension(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "(none)";
  return base.slice(dot).toLowerCase();
}

/**
 * Derives the stable argument key for a failure class.
 *
 * File-shaped tools contribute the path's extension (`path:.ts`); every other
 * tool contributes its own name (`tool:read_file`).
 */
export function deriveArgKey(toolName: string, args: unknown): string {
  const filePath = findFilePathArg(args);
  if (filePath !== undefined) {
    return `path:${fileExtension(filePath)}`;
  }
  return `tool:${toolName}`;
}

/**
 * Normalises an error message so that instances of the same defect collapse
 * into one class: absolute paths, relative paths, quoted values, ids, hex
 * blobs and numbers are all replaced by placeholders.
 */
export function normaliseErrorMessage(message: string): string {
  let out = message;
  out = out.replace(QUOTED_RE, "<value>");
  out = out.replace(UUID_RE, "<id>");
  out = out.replace(HEX_RE, "<hex>");
  out = out.replace(LONG_HEX_RE, "<hex>");
  out = out.replace(ABSOLUTE_PATH_RE, "<path>");
  out = out.replace(RELATIVE_PATH_RE, "<path>");
  out = out.replace(NUMBER_RE, "<n>");
  out = out.replace(/\s+/g, " ").trim().toLowerCase();
  return out.slice(0, NORMALIZED_MESSAGE_MAX_LENGTH);
}

/**
 * Computes the failure-class signature.
 *
 * The signature is `tool | dyad error kind | argument key | normalised error`,
 * so the same defect with a different path, id or number is the same class.
 */
export function computeFailureSignature(params: {
  toolName: string;
  args: unknown;
  error: unknown;
}): string {
  const toolName = params.toolName.toLowerCase();
  const errorKind = extractErrorKind(params.error);
  const argKey = deriveArgKey(params.toolName, params.args);
  const normalized = normaliseErrorMessage(extractErrorMessage(params.error));
  return `${toolName}|${errorKind}|${argKey}|${normalized}`;
}

/** An empty ledger. */
export function emptyLedger(): LedgerFile {
  return { version: 1, entries: {} };
}

/**
 * Loads the ledger. A missing or corrupt file yields an empty ledger rather
 * than an error: the ledger is evidence, never a hard dependency.
 */
export async function loadLedger(appPath: string): Promise<LedgerFile> {
  const filePath = getLedgerPath(appPath);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyLedger();
    const record = parsed as Partial<LedgerFile>;
    if (!record.entries || typeof record.entries !== "object") {
      return emptyLedger();
    }
    return {
      version: 1,
      entries: record.entries as Record<string, LedgerEntry>,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      logger.warn(`Failed to read ledger at ${filePath}:`, error);
    }
    return emptyLedger();
  }
}

/** Writes the ledger, creating `.dyad/self-heal/` when needed. */
export async function saveLedger(
  appPath: string,
  ledger: LedgerFile,
): Promise<void> {
  const filePath = getLedgerPath(appPath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(
    tmpPath,
    JSON.stringify(ledger, null, 2),
    "utf-8",
  );
  await fs.promises.rename(tmpPath, filePath);
}

/** Drops the least recently seen entries so the ledger stays bounded. */
export function capLedger(ledger: LedgerFile): LedgerFile {
  const entries = Object.values(ledger.entries);
  if (entries.length <= LEDGER_MAX_ENTRIES) return ledger;
  entries.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const kept: Record<string, LedgerEntry> = {};
  for (const entry of entries.slice(0, LEDGER_MAX_ENTRIES)) {
    kept[entry.signature] = entry;
  }
  return { version: 1, entries: kept };
}

/**
 * Records a tool failure and, when the failure class is new, returns the
 * self-heal instruction for the turn.
 *
 * This function never throws: a failure to record is logged, not fatal.
 *
 * @returns `{ signature, instruction }` when the caller should inject the
 * instruction, `undefined` otherwise.
 */
export async function recordToolFailure(params: {
  appPath: string;
  toolName: string;
  args: unknown;
  error: unknown;
  /** Turn-scoped dedupe set: a signature is only handled once per turn. */
  alreadyHandled: Set<string>;
}): Promise<{ signature: string; instruction: string } | undefined> {
  const { appPath, toolName, args, error, alreadyHandled } = params;

  if (isUserCancellation(error)) {
    return undefined;
  }

  const signature = computeFailureSignature({ toolName, args, error });

  // `undefined` means the ledger could not be read or written, so whether the
  // class is new is unknown. The turn-scoped set still keeps the injection to
  // once per turn.
  let existedBefore: boolean | undefined;
  try {
    const ledger = await loadLedger(appPath);
    const existing = ledger.entries[signature];
    existedBefore = existing !== undefined;
    const now = Date.now();
    const entry: LedgerEntry = existing
      ? {
          ...existing,
          occurrences: existing.occurrences + 1,
          lastSeenAt: now,
          errorMessage: extractErrorMessage(error).slice(
            0,
            ERROR_MESSAGE_MAX_LENGTH,
          ),
        }
      : {
          signature,
          toolName: toolName.toLowerCase(),
          errorKind: extractErrorKind(error),
          errorMessage: extractErrorMessage(error).slice(
            0,
            ERROR_MESSAGE_MAX_LENGTH,
          ),
          argKey: deriveArgKey(toolName, args),
          occurrences: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          status: "open",
        };
    ledger.entries[signature] = entry;
    await saveLedger(appPath, capLedger(ledger));
  } catch (ledgerError) {
    logger.warn(`Failed to record failure ${signature}:`, ledgerError);
  }

  if (existedBefore === true) {
    // Known class: the class was already handled in an earlier turn.
    return undefined;
  }
  if (alreadyHandled.has(signature)) {
    return undefined;
  }
  alreadyHandled.add(signature);
  return { signature, instruction: buildSelfHealInstruction(signature) };
}

/**
 * Updates the status of a ledger entry (for example to `handled` after a
 * finalised fix, or to `needs_human` when the Ralph budget is exhausted).
 */
export async function markLedgerStatus(
  appPath: string,
  signature: string,
  status: LedgerStatus,
): Promise<void> {
  try {
    const ledger = await loadLedger(appPath);
    const entry = ledger.entries[signature];
    if (!entry) return;
    ledger.entries[signature] = { ...entry, status };
    await saveLedger(appPath, capLedger(ledger));
  } catch (error) {
    logger.warn(`Failed to update ledger status for ${signature}:`, error);
  }
}
