/**
 * The bodies of the built-in skills, keyed by the slug that invokes them.
 *
 * Why the bodies live apart from the catalog: the catalog is metadata and
 * goes to the renderer, which needs to offer the slash commands. The bodies
 * are twenty-odd kilobytes of prompt text that only the main process ever
 * needs, and they must not end up in the renderer bundle.
 */

import {
  REPLICA_PREAMBLE,
  REPLICA_SKILL_BLOCKS,
} from "../replica_skills_prompt";
import { SKILL_AUTHORING_BLOCK } from "../skill_authoring_prompt";
import { SETUP_VERIFICATION_BLOCK } from "../setup_template_prompt";

/**
 * The body of every built-in skill, keyed by slug.
 *
 * The key set is checked against the catalog by a test, so a skill that is
 * listed but has no body fails the suite instead of silently doing nothing.
 */
export const BUILTIN_SKILL_CONTENT: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(REPLICA_SKILL_BLOCKS).map(([slug, block]) => [
      slug,
      `${REPLICA_PREAMBLE}\n\n${block}`,
    ]),
  ),
  "setup-template": SETUP_VERIFICATION_BLOCK,
  "skill-authoring": SKILL_AUTHORING_BLOCK,
};
