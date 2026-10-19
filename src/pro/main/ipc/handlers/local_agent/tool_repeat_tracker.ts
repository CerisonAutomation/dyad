/**
 * Consecutive-repeat detector for tool calls within one agent turn.
 *
 * A stuck agent repeats the exact same tool call with identical arguments
 * while the turn burns tokens. This tracker counts consecutive identical
 * calls (tool name plus canonically serialized arguments) and produces an
 * advisory reminder at configured thresholds. It never vetoes or rewrites
 * calls: the caller decides what to do with the reminder, typically by
 * injecting it as a user message before the next step.
 *
 * One tracker instance covers exactly one turn. A new user message starts a
 * new turn, so the caller must construct a fresh tracker per turn.
 */

export type RepeatReminderTier = "gentle" | "detailed" | "final";

export interface RepeatReminder {
  tier: RepeatReminderTier;
  toolName: string;
  count: number;
  text: string;
}

const DEFAULT_THRESHOLDS = [3, 5, 8];
const ARGUMENTS_PREVIEW_CHARS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalizeArguments(args: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(args)) ?? "null";
  } catch {
    return String(args);
  }
}

function previewArguments(canonical: string): string {
  if (canonical.length <= ARGUMENTS_PREVIEW_CHARS) return canonical;
  return `${canonical.slice(0, ARGUMENTS_PREVIEW_CHARS)}… (+${canonical.length - ARGUMENTS_PREVIEW_CHARS} more chars)`;
}

function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error("ToolRepeatTracker: thresholds must not be empty");
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(
        `ToolRepeatTracker: invalid threshold ${value} — every threshold must be an integer >= 2`,
      );
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error("ToolRepeatTracker: thresholds must not contain duplicates");
  }
  return [...values].sort((a, b) => a - b);
}

function buildReminderText(
  tier: RepeatReminderTier,
  toolName: string,
  count: number,
  canonicalArguments: string,
): string {
  if (tier === "gentle") {
    return (
      "You are repeating the exact same tool call with identical arguments. " +
      "Carefully analyze the previous result before calling again: if the task is " +
      "not complete, try a different approach or different arguments instead of " +
      "repeating the call."
    );
  }
  if (tier === "detailed") {
    return (
      "Repeated tool call detected:\n" +
      `- tool: ${toolName}\n` +
      `- consecutive_calls: ${count}\n` +
      `- arguments: ${previewArguments(canonicalArguments)}\n` +
      "The repeated calls are not making progress. Do not call this tool with " +
      "these exact arguments again. Inspect the latest result and choose a " +
      "different action, different arguments, or finish the task if enough " +
      "evidence has been gathered."
    );
  }
  return (
    `Still repeating ${toolName} after ${count} identical calls. ` +
    "Stop calling it. Summarize what the repeated results actually show, " +
    "state what is missing, and either try a fundamentally different approach " +
    "or ask the user how to proceed."
  );
}

function callKey(call: unknown): { toolName: string; canonical: string } | undefined {
  if (!isRecord(call)) return undefined;
  if (typeof call.toolName !== "string" || call.toolName.length === 0) {
    return undefined;
  }
  const args = "input" in call ? call.input : "args" in call ? call.args : null;
  return { toolName: call.toolName, canonical: canonicalizeArguments(args) };
}

export class ToolRepeatTracker {
  private readonly thresholds: number[];
  private lastKey: string | null = null;
  private runLength = 0;
  private readonly emitted = new Set<number>();

  constructor(thresholds: number[] = DEFAULT_THRESHOLDS) {
    this.thresholds = validateThresholds(thresholds);
  }

  /**
   * Feed one step's tool calls in order. Returns a reminder the first time
   * the consecutive run length reaches each configured threshold, otherwise
   * undefined. A call that differs from the streak, or one whose shape cannot
   * be compared, ends the streak.
   */
  observeStep(toolCalls: Array<unknown>): RepeatReminder | undefined {
    let reminder: RepeatReminder | undefined;
    for (const call of toolCalls) {
      const parsed = callKey(call);
      if (parsed === undefined) {
        this.lastKey = null;
        this.runLength = 0;
        continue;
      }
      const key = JSON.stringify([parsed.toolName, parsed.canonical]);
      if (key === this.lastKey) {
        this.runLength += 1;
      } else {
        this.lastKey = key;
        this.runLength = 1;
      }
      if (
        this.thresholds.includes(this.runLength) &&
        !this.emitted.has(this.runLength)
      ) {
        this.emitted.add(this.runLength);
        const tier: RepeatReminderTier =
          this.runLength === this.thresholds[0]
            ? "gentle"
            : this.runLength === this.thresholds[1]
              ? "detailed"
              : "final";
        reminder = {
          tier,
          toolName: parsed.toolName,
          count: this.runLength,
          text: buildReminderText(
            tier,
            parsed.toolName,
            this.runLength,
            parsed.canonical,
          ),
        };
      }
    }
    return reminder;
  }

  reset(): void {
    this.lastKey = null;
    this.runLength = 0;
    this.emitted.clear();
  }
}
