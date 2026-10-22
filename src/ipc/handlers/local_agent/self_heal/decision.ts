/**
 * Fast decision layer.
 *
 * The self-heal gates are cheap, typed questions: "is this worth attempting?",
 * "is this diagnosis plausible?", "should the loop continue?". They are
 * answered by shelling out to the `jev` CLI — never by an in-process API — so
 * the decision is a separate, auditable process with its own timeout.
 *
 * Every gate in this module FAILS CLOSED: when the CLI is missing, errors,
 * times out or returns something unparseable, the caller receives
 * `{ ok: false, score: 0, unavailable: true }` and must take its safe default
 * (skip the self-heal, reject the diagnosis, stop the loop, veto the diff,
 * keep the original prompt).
 */

import { spawn } from "node:child_process";
import log from "electron-log";
import { buildWindowsCommandInvocation } from "@/ipc/utils/windows_command";
import type { JevScoreDecision, JevYesNoDecision } from "./types";

const logger = log.scope("self_heal_decision");

/** Hard timeout for a single CLI invocation. */
export const DEFAULT_JEV_TIMEOUT_MS = 2000;

/** Maximum captured output per stream, so a runaway CLI cannot exhaust memory. */
const MAX_OUTPUT_CHARS = 64 * 1024;

/** The two CLI modes this module uses. */
export type JevMode = "yes" | "score";

/** A resolved CLI invocation. */
export interface JevCommand {
  command: string;
  args: string[];
}

/** Result of a parsed CLI response. */
export interface ParsedJevOutput {
  /** For "yes": the verdict. For "score": true when a value was parsed. */
  ok: boolean;
  /** Confidence on a 0-10 scale. 0 means "no information". */
  score: number;
  /** True when the output carried nothing usable. */
  unavailable: boolean;
}

const PLAIN_YES_RE = /^(yes|no)\b[\s\t]*(-?[0-9]*\.?[0-9]+)?/i;
const PLAIN_SCORE_RE = /^(-?[0-9]*\.?[0-9]+)[\s\t]+(\S*)$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds to one decimal so scores keep their resolution. */
function toScore(value: number): number {
  return Math.round(clamp(value, 0, 10) * 10) / 10;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Parses a numeric capture group; returns undefined when it is not a number. */
function asNumericString(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parses the typed output of the `jev` CLI.
 *
 * Handles both machine-readable output (`--json`) and the plain stdout form.
 * Anything that carries no usable number is reported as unavailable so the
 * caller fails closed instead of guessing.
 *
 * Score scale: the CLI is asked for a 1..10 ordinal, which maps 1:1 onto the
 * module's 0-10 scale. `0` is reserved for "no information" (unavailable).
 */
export function parseJevOutput(raw: string, mode: JevMode): ParsedJevOutput {
  const text = (raw ?? "").trim();
  if (!text) {
    return { ok: false, score: 0, unavailable: true };
  }

  const parsed = asRecord(tryParseJson(text));
  if (parsed) {
    const answer = asRecord(parsed.answer);
    if (answer) {
      if (mode === "yes") {
        const noul = asNumber(answer.noul);
        if (noul !== undefined) {
          const probability = clamp(noul, 0, 1);
          const verdict =
            typeof answer.yes === "boolean" ? answer.yes : probability >= 0.5;
          return {
            ok: verdict,
            score: toScore(probability * 10),
            unavailable: false,
          };
        }
      } else {
        const value = asNumber(answer.value) ?? asNumber(answer.score);
        if (value !== undefined) {
          return { ok: true, score: toScore(value), unavailable: false };
        }
      }
    }
  }

  if (mode === "yes") {
    const match = PLAIN_YES_RE.exec(text);
    if (match) {
      const probability = asNumericString(match[2]);
      if (probability !== undefined) {
        const clamped = clamp(probability, 0, 1);
        return {
          ok: match[1].toLowerCase() === "yes",
          score: toScore(clamped * 10),
          unavailable: false,
        };
      }
    }
    return { ok: false, score: 0, unavailable: true };
  }

  const scoreMatch = PLAIN_SCORE_RE.exec(text);
  if (scoreMatch) {
    const value = asNumericString(scoreMatch[1]);
    if (value !== undefined) {
      return { ok: true, score: toScore(value), unavailable: false };
    }
  }
  return { ok: false, score: 0, unavailable: true };
}

/** `JSON.parse` that returns undefined instead of throwing. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Result of running the CLI. */
export interface JevRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function spawnProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<JevRunResult> {
  return new Promise((resolve) => {
    let invocation: ReturnType<typeof buildWindowsCommandInvocation>;
    try {
      invocation = buildWindowsCommandInvocation(command, args);
    } catch (error) {
      logger.warn(`Cannot launch "${command}" on this platform:`, error);
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        code: null,
        timedOut: false,
      });
      return;
    }

    let child;
    try {
      child = spawn(invocation.command, invocation.args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: invocation.useVerbatimArguments === true,
      });
    } catch (error) {
      logger.warn(`Failed to spawn "${invocation.command}":`, error);
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        code: null,
        timedOut: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: !timedOut, stdout, stderr, code, timedOut });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      logger.warn(`Failed to run "${command}":`, error);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

let cachedCommand: JevCommand | undefined;

/**
 * Finds the `jev` CLI.
 *
 * Resolution order: `JEV_CLI_PATH`, then `jev` on `PATH`, then
 * `npx --no-install jev`. The last candidate is always returned when the
 * first two fail, so a missing or broken CLI surfaces as an unavailable
 * decision (fail closed) rather than as a missing command.
 */
export async function resolveJevCommand(): Promise<JevCommand | undefined> {
  // The env var always wins, so a changed configuration takes effect at once.
  const configured = process.env.JEV_CLI_PATH?.trim();
  if (configured) {
    return { command: configured, args: [] };
  }

  if (cachedCommand) return cachedCommand;

  const whichCommand = process.platform === "win32" ? "where" : "which";
  const located = await spawnProcess(whichCommand, ["jev"], 1000);
  const firstLine = located.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (located.ok && firstLine) {
    cachedCommand = { command: firstLine, args: [] };
    return cachedCommand;
  }

  return { command: "npx", args: ["--no-install", "jev"] };
}

/** Clears the cached CLI resolution (used by tests). */
export function resetJevCommandCache(): void {
  cachedCommand = undefined;
}

function buildArgs(
  mode: JevMode,
  question: string,
  state: string,
  criteria: { true: string; false: string } | undefined,
  timeoutMs: number,
): string[] {
  const args: string[] = [];
  if (mode === "yes") {
    args.push("yes", question);
    if (criteria) {
      args.push("--true", criteria.true, "--false", criteria.false);
    }
  } else {
    args.push("score", question, "--range", "1-10");
  }
  args.push(
    "-s",
    state,
    "--json",
    "--timeout",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "--retries",
    "0",
  );
  return args;
}

async function invokeJev(params: {
  mode: JevMode;
  question: string;
  state: string;
  criteria?: { true: string; false: string };
  timeoutMs: number;
}): Promise<ParsedJevOutput> {
  const command = await resolveJevCommand();
  if (!command) {
    return { ok: false, score: 0, unavailable: true };
  }
  const args = [
    ...command.args,
    ...buildArgs(
      params.mode,
      params.question,
      params.state,
      params.criteria,
      params.timeoutMs,
    ),
  ];
  const result = await spawnProcess(command.command, args, params.timeoutMs);
  if (result.timedOut) {
    logger.warn(`jev timed out after ${params.timeoutMs}ms`);
    return { ok: false, score: 0, unavailable: true };
  }
  // `jev yes` exits 1 for a "no" verdict; that is a real answer, not an error.
  const expectedExit = params.mode === "yes" ? [0, 1] : [0];
  if (
    !result.ok ||
    result.code === null ||
    !expectedExit.includes(result.code)
  ) {
    logger.warn(
      `jev failed (exit ${result.code}): ${result.stderr.trim().slice(0, 500)}`,
    );
    return { ok: false, score: 0, unavailable: true };
  }
  return parseJevOutput(result.stdout, params.mode);
}

async function askYesNo(params: {
  question: string;
  state: string;
  trueDesc: string;
  falseDesc: string;
  timeoutMs: number;
}): Promise<JevYesNoDecision> {
  const parsed = await invokeJev({
    mode: "yes",
    question: params.question,
    state: params.state,
    criteria: { true: params.trueDesc, false: params.falseDesc },
    timeoutMs: params.timeoutMs,
  });
  if (parsed.unavailable) {
    return { ok: false, score: 0, unavailable: true };
  }
  return { ok: parsed.ok, score: parsed.score, unavailable: false };
}

async function askScore(params: {
  question: string;
  state: string;
  timeoutMs: number;
}): Promise<JevScoreDecision> {
  const parsed = await invokeJev({
    mode: "score",
    question: params.question,
    state: params.state,
    timeoutMs: params.timeoutMs,
  });
  if (parsed.unavailable) {
    return { score: 0, unavailable: true };
  }
  return { score: parsed.score, unavailable: false };
}

/**
 * Asks a generic yes/no question about the given state.
 *
 * Fails closed: an unavailable decision is `{ ok: false, score: 0 }`.
 */
export async function decideYesNo(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevYesNoDecision> {
  return askYesNo({
    question:
      "Does the state below describe a real, actionable problem that should be acted on?",
    state: input,
    trueDesc: "The state describes an actionable problem",
    falseDesc: "The state does not describe an actionable problem",
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}

/**
 * Asks for a 0-10 score for the given state.
 *
 * Fails closed: an unavailable decision is `{ score: 0 }`.
 */
export async function decideScore(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevScoreDecision> {
  return askScore({
    question:
      "How confident are you that the state below is correct, specific and actionable?",
    state: input,
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}

/**
 * Gate: is this failure signature worth a self-heal attempt?
 *
 * Fail-closed default: skip the self-heal.
 */
export async function isWorthSelfHealAttempt(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevYesNoDecision> {
  return askYesNo({
    question:
      "Is this tool failure a Dyad defect that a code change in the Dyad repository can plausibly fix?",
    state: input,
    trueDesc:
      "A change in the Dyad source can fix this failure, for example a wrong contract, a missing guard or a broken error path",
    falseDesc:
      "The failure is caused by the user, the environment, missing credentials, a user decision, or a resource that is simply unavailable",
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}

/**
 * Gate: is this merged diagnosis plausible?
 *
 * Fail-closed default: reject the diagnosis.
 */
export async function isDiagnosisPlausible(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevYesNoDecision> {
  return askYesNo({
    question:
      "Is this merged diagnosis the actual root cause of the observed failure?",
    state: input,
    trueDesc:
      "The diagnosis names a concrete code path that explains the exact error observed",
    falseDesc:
      "The diagnosis is a guess, a restatement of the symptom, or names no concrete code path",
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}

/**
 * Gate: should the Ralph loop continue or stop?
 *
 * Fail-closed default: stop the loop.
 */
export async function shouldContinueRalphLoop(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevYesNoDecision> {
  return askYesNo({
    question:
      "Is there a concrete, evidence-backed next step that can still make this fix succeed?",
    state: input,
    trueDesc:
      "The evidence shows a specific remaining cause that another diagnosis or fix attempt can address",
    falseDesc:
      "The evidence is exhausted, the failure is not reproducible, or no new information can be gained",
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}

/**
 * Gate: is this diff a fix for the diagnosed root cause?
 *
 * Fail-closed default: veto the diff.
 */
export async function isDiffRootCauseFix(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevYesNoDecision> {
  return askYesNo({
    question:
      "Does this diff fix the diagnosed root cause of the failure, without widening the scope?",
    state: input,
    trueDesc:
      "Every change in the diff addresses the diagnosed root cause and nothing else",
    falseDesc:
      "The diff contains unrelated changes, refactors, formatting churn or fixes a symptom instead of the cause",
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}

/**
 * Gate: is this prompt rewrite safe to apply?
 *
 * Fail-closed default: keep the original prompt.
 */
export async function isPromptRewriteSafe(
  input: string,
  options?: { timeoutMs?: number },
): Promise<JevYesNoDecision> {
  return askYesNo({
    question:
      "Is this rewritten prompt safe to apply, keeping the user's intent intact?",
    state: input,
    trueDesc:
      "The rewrite keeps the user's intent and only adds guidance, tool names or rules",
    falseDesc:
      "The rewrite changes, narrows or redirects the user's request, or drops an explicit instruction",
    timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
  });
}
