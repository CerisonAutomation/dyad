/**
 * The skill catalog for the system prompt.
 *
 * Why a catalog and not the skills themselves: the situational skills are
 * long - the Replica pack alone is twenty-nine kilobyte - and they apply to
 * a small fraction of turns. Carrying them in every prompt costs every
 * conversation, every turn, for requests they have nothing to do with.
 *
 * So the system prompt carries the list, and the body arrives when it is
 * needed: the user types the slash command, and the full instructions arrive
 * with their message. The catalog exists so the agent can name the right
 * command instead of guessing, and so a request that matches a skill is
 * recognised even when the user did not type the command.
 */

import { BUILTIN_SKILL_CATALOG } from "./builtin_skills/catalog";
import { REPLICA_WORKFLOW_BLOCK } from "./replica_skills_prompt";

/**
 * The catalog, rendered for a system prompt.
 *
 * Built from the catalog rather than written by hand, so a skill that is
 * added to the catalog cannot be missing from the prompt. The copy is kept
 * short on purpose: this block is on every turn, so every word in it is paid
 * for by every conversation.
 */
export const SKILL_CATALOG_BLOCK = `<skills>
These skills are not part of your instructions by default. Each has a slash command; when the user types it, the full instructions arrive with their message.

${BUILTIN_SKILL_CATALOG.map(
  (skill) =>
    `- \`/${skill.slug}\` - ${skill.description} Use it: ${skill.whenToUse}`,
).join("\n")}

When a request matches one of these skills and the user has not typed its command, say which command applies and ask for it in one line rather than guessing at the contents. When the user types the command, follow the instructions that arrive with their message - they are the skill, and they replace your own approach to that kind of work.
</skills>`;

/**
 * The skill section of a prompt.
 *
 * The catalog is always present so the agent can name a skill and point the
 * user at its command. The bodies are present only when the conversation is
 * actually about that skill: the Replica pack alone is twenty-nine kilobyte
 * of staged workflow, and carrying it on every turn of every conversation
 * buys nothing for the requests it has nothing to do with.
 */
export function buildSkillsSection(isCloneWorkflow: boolean): string {
  if (!isCloneWorkflow) {
    return SKILL_CATALOG_BLOCK;
  }
  return `${SKILL_CATALOG_BLOCK}

${REPLICA_WORKFLOW_BLOCK}`;
}
