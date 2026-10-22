/**
 * Prevention rule store.
 *
 * Every finalised self-heal ends with a rule that must hold in future turns.
 * The rules are stored at `<appPath>/.dyad/self-heal/prevention.json` and
 * rendered into a compact prompt block that is injected into local-agent
 * turns, so a fixed bug cannot silently return.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import type { PreventionFile, PreventionRule } from "./types";

const logger = log.scope("self_heal_prevention");

/** Maximum number of rules rendered into the prompt block. */
export const PREVENTION_PROMPT_MAX_RULES = 20;

/** Path of the prevention file for an app. */
export function getPreventionPath(appPath: string): string {
  return path.join(appPath, ".dyad", "self-heal", "prevention.json");
}

/** An empty prevention file. */
export function emptyPrevention(): PreventionFile {
  return { version: 1, rules: [] };
}

/**
 * Loads the prevention rules, newest first. A missing or corrupt file yields
 * an empty rule set rather than an error.
 */
export async function loadPreventionRules(
  appPath: string,
): Promise<PreventionRule[]> {
  const filePath = getPreventionPath(appPath);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as Partial<PreventionFile>;
    if (!Array.isArray(record.rules)) return [];
    return record.rules
      .filter(
        (rule): rule is PreventionRule =>
          !!rule &&
          typeof rule === "object" &&
          typeof rule.id === "string" &&
          typeof rule.title === "string" &&
          typeof rule.rule === "string",
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      logger.warn(`Failed to read prevention rules at ${filePath}:`, error);
    }
    return [];
  }
}

/** Writes the prevention rules. */
export async function savePreventionRules(
  appPath: string,
  rules: PreventionRule[],
): Promise<void> {
  const filePath = getPreventionPath(appPath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(
    tmpPath,
    JSON.stringify({ version: 1, rules }, null, 2),
    "utf-8",
  );
  await fs.promises.rename(tmpPath, filePath);
}

/** Builds a stable, readable id from a rule title. */
export function buildRuleId(title: string, taken: Set<string>): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = slug || "prevention-rule";
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

/**
 * Adds (or refreshes) a prevention rule derived from a failure class.
 *
 * When a rule already exists for the same source signature its occurrence
 * count is incremented and its text is refreshed, so the rule always reflects
 * the latest diagnosis.
 */
export async function addPreventionRule(
  appPath: string,
  input: {
    title: string;
    rule: string;
    sourceSignature: string;
    occurrences?: number;
  },
): Promise<PreventionRule> {
  const rules = await loadPreventionRules(appPath);
  const existing = rules.find(
    (rule) => rule.sourceSignature === input.sourceSignature,
  );
  const now = Date.now();
  let created: PreventionRule;
  if (existing) {
    created = {
      ...existing,
      title: input.title,
      rule: input.rule,
      occurrences: input.occurrences ?? existing.occurrences + 1,
    };
  } else {
    const taken = new Set(rules.map((rule) => rule.id));
    created = {
      id: buildRuleId(input.title, taken),
      title: input.title,
      rule: input.rule,
      createdAt: now,
      sourceSignature: input.sourceSignature,
      occurrences: input.occurrences ?? 1,
    };
  }
  const next = [
    created,
    ...rules.filter((rule) => rule.id !== created.id),
  ].sort((a, b) => b.createdAt - a.createdAt);
  await savePreventionRules(appPath, next);
  return created;
}

/**
 * Renders the prevention rules as a compact prompt block.
 *
 * At most the {@link PREVENTION_PROMPT_MAX_RULES} most recent rules are
 * rendered. Returns an empty string when there are no rules, so callers can
 * concatenate the result unconditionally.
 */
export async function buildPreventionPromptBlock(
  appPath: string,
): Promise<string> {
  const rules = await loadPreventionRules(appPath);
  if (rules.length === 0) return "";
  const lines = rules
    .slice(0, PREVENTION_PROMPT_MAX_RULES)
    .map(
      (rule) =>
        `- ${rule.title}: ${rule.rule} (seen ${rule.occurrences}x, from ${rule.sourceSignature})`,
    );
  return [
    "<dyad-prevention-rules>",
    "Rules learned from earlier failures in this workspace. Follow them; they exist because the same failure already happened.",
    ...lines,
    "</dyad-prevention-rules>",
  ].join("\n");
}
