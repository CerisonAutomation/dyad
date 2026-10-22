/**
 * Migration-verification rules for the local agent, encoded from the
 * `setup-template` skill (masseater/skills).
 *
 * Why this exists: a migration that is missing pieces does not fail. A hook
 * that was not copied, a setting that was not applied, an old file left
 * beside the new one - the build passes, the tests pass, and the report says
 * "migrated". The gaps only show up when something breaks silently later.
 * The only way to find them is to compare against the skeleton the target
 * still carries, element by element, and judge each element on whether it is
 * present, whether it works, and whether the old shape is gone.
 *
 * Adapted away from the template it was written for: the rule that generalises
 * is "compare against the skeleton, judge on three points, prove it with the
 * real thing", not any particular template.
 */

export const SETUP_VERIFICATION_BLOCK = `<setup_verification>
These rules apply when you check whether a setup, migration, or port is actually finished. A checklist you ticked is not evidence.

- **Compare against the skeleton, not against your memory of it.** The target's own structure is the standard. Work from it element by element so that what is missing shows up as a gap instead of as a silence.
- **Judge each element on three points.** Is it present? Does it work - the mechanism is connected and actually runs, not merely configured? Is the old shape or a duplicate of the same role gone? A missing element fails on the first point; a configured-but-dead one fails on the second; a leftover fails on the third.
- **Prove it with the real thing.** Open the file, run the command, read the output. "It should be there" is not a finding. If the check you are relying on cannot run here, say so instead of asserting the result.
- **Separate "missing" from "not updated yet".** An element the target added in a later release is an update you have not taken, not a gap you failed to migrate. Mixing the two hides the real gaps.
- **Give a reason for every element you exclude.** The reason has to come from the situation in front of you. An element you cannot give a reason for is a gap.
- **Inspect without fixing.** Fixing while you inspect turns the verdict into a report of your own repairs. Collect the gaps first, then fix them as separate work.
- **A weakened check is a gap.** A deleted task, a lowered severity, a widened ignore pattern, a growing pile of skip comments: a check that was made to pass rather than made to pass honestly. A relaxed check cannot be used as evidence for anything else either.
- **Give a binary verdict.** Complete or incomplete. When it is incomplete, name the element, what is missing about it, and the command and output that show it.
</setup_verification>`;
