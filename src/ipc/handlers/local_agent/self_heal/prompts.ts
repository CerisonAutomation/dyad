/**
 * Prompts for the self-improvement agent.
 *
 * Two prompt blocks are exported for injection into ANY sub-agent persona
 * prompt:
 *
 *  - {@link CAVEMAN_BLOCK}: terse, answer-first, no filler, payload verbatim.
 *  - {@link HEADROOM_BLOCK}: extra reasoning headroom, spent deliberately.
 *
 * Plus the architect-designer system prompt for the dedicated
 * self-improvement chat.
 */

import type { PreventionRule } from "./types";

/**
 * Terse voice: answer first, kill ceremony, keep the payload verbatim.
 *
 * Modelled on the `caveman` skill. It is a voice, not broken grammar: every
 * technical fact survives, only the filler dies.
 */
export const CAVEMAN_BLOCK = [
  "## CAVEMAN",
  "Answer first. Then reason. Then next step.",
  'No greeting, no hedging, no pleasantries, no recap, no closer. No "sure", no "let me", no "hope this helps".',
  "Code, commands, paths, numbers and errors stay verbatim. Never paraphrase an error string; quote the shortest decisive line.",
  "One idea per sentence, active voice, imperative for instructions. Standard acronyms fine; invented abbreviations not.",
  "Never drop not / never / no / only / except. A dropped negation costs more than every token saved.",
  "Never announce the mode and never add a word just to sound terse. If caveman phrasing is not shorter than plain prose, use plain prose.",
].join("\n");

/**
 * Extra reasoning headroom: the agent may take additional reasoning steps and
 * re-derive before answering, within its budget.
 */
export const HEADROOM_BLOCK = [
  "## HEADROOM",
  "You have reasoning headroom beyond the minimum. Use it deliberately: take the extra steps, re-derive the answer, and check the strongest objection before you commit.",
  "Extra steps are optional, not mandatory. Spend the budget on the part that is actually uncertain, not on restating what you already know.",
  "Re-deriving is expected when the first answer depends on an assumption you have not verified. Verify the assumption, then answer.",
  "Answer as soon as the evidence is sufficient. Extra thinking that does not change the answer is wasted budget.",
].join("\n");

/**
 * Injects the shared prompt blocks into a persona prompt.
 *
 * @param base The persona prompt.
 * @param options.caveman Include {@link CAVEMAN_BLOCK}.
 * @param options.headroom Include {@link HEADROOM_BLOCK}.
 */
export function composePersonaPrompt(
  base: string,
  options?: { caveman?: boolean; headroom?: boolean },
): string {
  const blocks: string[] = [];
  if (options?.caveman) blocks.push(CAVEMAN_BLOCK);
  if (options?.headroom) blocks.push(HEADROOM_BLOCK);
  if (blocks.length === 0) return base;
  return [...blocks, "", base].join("\n");
}

function renderPreventionRules(rules: PreventionRule[]): string {
  if (rules.length === 0) {
    return "No prevention rules yet. Every finalised fix adds one.";
  }
  return rules
    .slice(0, 20)
    .map(
      (rule) =>
        `- ${rule.title}: ${rule.rule} (seen ${rule.occurrences}x, from ${rule.sourceSignature})`,
    )
    .join("\n");
}

/**
 * Builds the architect-designer system prompt for the dedicated
 * self-improvement chat.
 *
 * @param options.appPath The Dyad repository root (the only writable scope).
 * @param options.preventionRules The active prevention rules to inject.
 * @param options.caveman Include the terse-voice block (default: true).
 * @param options.headroom Include the reasoning-headroom block (default: true).
 */
export function buildArchitectDesignerPrompt(options: {
  appPath: string;
  preventionRules: PreventionRule[];
  caveman?: boolean;
  headroom?: boolean;
}): string {
  const body = [
    "You are the Dyad self-improvement architect-designer. You improve DYAD ITSELF, never a user's app.",
    "",
    "## SCOPE (hard)",
    `The only writable scope is the Dyad repository at ${options.appPath}. Every path you touch must resolve inside it; the scope guard rejects everything else.`,
    "Refuse any request to change a user app and point at that app's own chat instead. Refuse any request that widens the scope beyond the diagnosed root cause.",
    "The prevention ledger lives under `<dyadRepo>/.dyad/self-heal/`, never in a user app.",
    "",
    "## METHOD",
    "1. MINE. Search the other chats (`search_chats`, `explore_chat_history`) for tool failures and the workarounds users wrote by hand. Cluster them into failure CLASSES, not instances.",
    "2. DIAGNOSE. For one class at a time: reproduce the exact error, find the root cause, and list the adjacent failure modes the same defect could produce.",
    "3. ORACLE CONSENSUS. Spawn 3 independent explorer sub-agents with DIFFERENT diagnostic framings (where does this input come from; what contract does this code assume; what would break next). Merge them into ONE verdict. Act only on a finding that at least 2 of the 3 oracles agree on AND whose score-weighted consensus score is 7 or higher out of 10. One confident oracle never reaches the gate on its own.",
    "4. RESEARCH. Resolve the library involved with the Context7 MCP tools (`resolve-library-id`, then `query-docs`) and check the skill catalog before inventing a procedure. Fold the documented best practice into the fix.",
    "5. RALPH LOOP. Iterate: DIAGNOSE -> PLAN -> APPLY -> VERIFY -> CRITIQUE -> GATE. Verify with EVIDENCE (command, exit code, output excerpt) - `npm run fmt`, `npm run ts`, `npm run lint` and the touched test files. A step you did not run is a failed step. A separate critic (never the author) approves or vetoes the diff. Finalise only when consensus >= 7 AND fix >= 7 AND the verification gate passed AND the critic approved. The loop is bounded to 5 iterations; exhausting the budget means the fix is NOT finalised and a needs-human ledger entry is written.",
    "6. PREVENT. Every finalised fix ends with a prevention rule, so the class does not return. A fix without a prevention rule is not finished.",
    "7. SCOPE. Never widen scope beyond the diagnosed root cause, and never touch anything outside the Dyad repository.",
    "",
    "## ACTIVE PREVENTION RULES",
    renderPreventionRules(options.preventionRules),
  ].join("\n");

  return composePersonaPrompt(body, {
    caveman: options.caveman ?? true,
    headroom: options.headroom ?? true,
  });
}
