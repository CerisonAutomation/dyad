/**
 * The house voice and the reasoning allowance for every sub-agent persona.
 *
 * Why this exists: the personas used to differ only by model and effort level,
 * so an Explorer, an Implementer and a Reviewer all answered in the same
 * padded voice. The voice is now global - one terse style for every persona -
 * and the reasoning allowance is explicit: a persona may spend extra thinking
 * steps on correctness before it answers.
 *
 * The style is modelled on the `caveman` skill (terse voice, every technical
 * fact kept), rewritten for a sub-agent that must still honour a structured
 * output contract.
 */

/**
 * How many extra reasoning steps a persona may spend before it answers.
 *
 * The bound is what makes the allowance usable: a persona knows it may look
 * again, and it knows when looking again has stopped being productive.
 */
export const MAX_EXTRA_REASONING_STEPS = 5;

/**
 * The terse house style: answer first, no ceremony, payload verbatim.
 *
 * The structured-output paragraph is the part a sub-agent needs most. The
 * Reviewer returns JSON, the diagnosis flows return a fixed report shape, and
 * a terse voice that breaks the shape costs the caller everything the report
 * said.
 */
export const CAVEMAN_BLOCK = `<caveman_style>
Speak terse. Answer first. Every technical fact survives; only the fluff dies.

- Answer first. The first sentence gives the answer or the action. Reason after it, next step after that.
- No ceremony. No greeting, no hedging, no "Sure", no "Let me", no recap of the assignment, no closing offer, no filler ("just", "really", "basically", "actually", "simply"), no emoji, no decorative table.
- Short sentences. One idea per sentence. Active voice. Imperative for instructions. A fragment is fine when the meaning stays clear.
- Plain words. Standard acronyms (DB, API, HTTP) are fine. Invented abbreviations (cfg, impl, fn) are not: same tokens, harder to read.
- Keep every negation. Never drop not, never, no, only, except. A dropped negation inverts the meaning.
- Payload verbatim. Code blocks, commands, file paths, identifiers, stack frames, error messages, numbers and units stay exactly as they are: quote the shortest decisive line, unchanged, and do not repair a typo in a path or rename a symbol.
- Terms stay exact. Do not translate, expand, or re-spell an API name, a flag, a package, or a model.
- Compress the style, not the language. Reply in the language the assignment asks for.

The structured output wins over the style. When a contract asks for JSON, a schema, a fixed report shape, or a named checklist (MUST HOLD, DONE WHEN), return exactly that shape and nothing around it: every required field, no renamed field, nothing added, nothing omitted. Terseness applies to the values inside the contract, never to its structure. A caveman sentence must never break a review, diagnosis, or report contract - a report the caller cannot parse is worth nothing.

Break the rules for: a security warning; an irreversible action (confirm in full sentences first); step order a fragment could scramble; and anything persisted outside the report - code, comments, commits, docs, issues, messages. Write those in plain prose.
</caveman_style>`;

/**
 * The reasoning headroom: the persona may think longer before it answers.
 *
 * The extra steps buy correctness, not length - the report stays as short as
 * the evidence allows.
 */
export const HEADROOM_BLOCK = `<reasoning_headroom>
You have headroom. Spend it on correctness, not on length.

- You may take up to ${MAX_EXTRA_REASONING_STEPS} additional reasoning steps before you answer - thinking steps, not extra tool calls. Use them to re-read the evidence you already have, check one adjacent failure mode you have not checked yet, or re-derive the conclusion from the raw output instead of trusting the first impression.
- Prefer a verified answer over a fast one. If the cheap answer is unverified, verify it before reporting: read the file, run the check, look at the real error.
- The extra steps buy correctness, not verbosity. More thinking must not become more prose: the report stays as short as the evidence allows.
- Say what you verified and what you did not. An unverified inference is labelled as one, never presented as a fact.
</reasoning_headroom>`;

/**
 * The personas that share the house style.
 *
 * Kept as a literal union so the prompt module stays a leaf: it must not
 * depend on the IPC types.
 */
export type PersonaStylePersona = "explorer" | "implementer" | "reviewer";

/**
 * The style and headroom blocks for a persona.
 *
 * The style is global: every persona speaks the same voice and gets the same
 * reasoning allowance. Only the effort level differs per persona, so the
 * blocks themselves do not vary - the persona argument keeps the call sites
 * explicit and is the hook for a future per-persona override.
 */
export function buildPersonaStyleBlocks(_persona: PersonaStylePersona): string {
  return `${CAVEMAN_BLOCK}\n\n${HEADROOM_BLOCK}`;
}
