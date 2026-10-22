/**
 * Deterministic self-heal instruction builder.
 *
 * The instruction is a fixed template: no model call, no randomness, so the
 * same failure class always produces the same guidance and the turn stays
 * reproducible.
 */

/**
 * Builds the instruction injected into a turn when a tool failure class is
 * seen for the first time.
 *
 * @param signature The failure-class signature (see `ledger.ts`).
 */
export function buildSelfHealInstruction(signature: string): string {
  return [
    `<dyad-self-heal signature="${signature}">`,
    "A Dyad tool call failed. This is a Dyad defect, not a user error: diagnose and fix it in the Dyad repository. Follow the loop below exactly. Do not skip a step and do not claim a step you did not run.",
    "",
    "1. REPRODUCE. Re-read the exact error and the exact arguments from the failing call. No guessing about what the error probably said.",
    "2. DIAGNOSE. Find the root cause before proposing any change. Then list the adjacent failure modes the same defect could produce, so the fix covers the class and not just the instance.",
    "3. ORACLE CONSENSUS. Spawn 3 independent explorer sub-agents, each with a DIFFERENT diagnostic framing (for example: where does this input come from; what contract does this code assume; what would break next). Merge their reports into ONE verdict. A finding is only actionable when at least 2 of the 3 oracles agree AND the score-weighted consensus score is 7 or higher out of 10. One confident oracle never reaches the gate on its own.",
    "4. RESEARCH. Resolve the library involved with the Context7 MCP tools (resolve-library-id, then query-docs) and fold the documented best practice into the fix. Check the skill catalog for a matching skill before inventing a procedure.",
    "5. PLAN. Write the hypothesis, the smallest fix that addresses that root cause, and the prevention rule that will keep the class from returning. Never widen scope beyond the diagnosed root cause.",
    "6. APPLY. Edit the Dyad source only. Every path you touch must be inside the Dyad repository; the scope guard rejects anything else. Never modify a user app.",
    "7. VERIFY. Run the real checks and report EVIDENCE, not a claim: the command, its exit code, and a short excerpt of its output. Minimum set: npm run fmt, npm run ts, npm run lint, and the touched test files. A verification step that was not run is a FAILED verification step.",
    "8. CRITIQUE. A separate critic pass, by a reviewer that did NOT author the fix, reviews the diff against the diagnosed root cause and the prevention rule. The critic returns approve or veto plus reasons. A veto keeps the loop running.",
    "9. GATE. Finalise only when ALL of these hold: consensus score >= 7, fix score >= 7, the verification gate passed, and the critic approved. Otherwise go back to diagnosis with the new evidence attached. The loop is bounded to 5 iterations per failure class; exhausting the budget means the fix is NOT finalised and a needs-human ledger entry is written instead.",
    "10. PREVENT. Only after the gate passes, record the prevention rule so the rule is injected into future turns.",
    "",
    "The fast decision layer (typed yes/no and 0-10 scores) may be used to score candidate diagnoses. Treat every score it returns as an input, never as the decision itself: it cannot widen the scope and it cannot finalise a fix on its own.",
    "</dyad-self-heal>",
  ].join("\n");
}
