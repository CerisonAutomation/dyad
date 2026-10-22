/**
 * The built-in skill catalog: the skills Dyad ships, and the slash command
 * that invokes each one.
 *
 * Why a catalog rather than a pile of prompt strings: a skill is only useful
 * when the agent knows it exists, and a skill is only reachable when it has a
 * name the user can type. Both need the same list, and the list has to have
 * one home - a second copy drifts, and a skill that is not in the catalog
 * cannot be invoked.
 *
 * This module is metadata only, so the renderer can import it to offer the
 * slash commands without pulling the skill bodies into the renderer bundle.
 * The bodies live in `./content`, which the main process imports.
 */

export interface BuiltinSkill {
  /** The slash command that invokes this skill, without the leading slash. */
  slug: string;
  /** One line: what the skill does. */
  description: string;
  /** When to reach for it. */
  whenToUse: string;
}

/**
 * The Replica pack, in stage order.
 *
 * The stages are listed separately rather than as one "clone an app" skill
 * because the pack is a project: the agent sits on one stage at a time, and
 * a user who wants to redo the design stage should be able to ask for that
 * stage by name.
 */
const REPLICA_SKILL_CATALOG: readonly BuiltinSkill[] = [
  {
    slug: "replica-recon",
    description: "Map an app's screens, flows, components and data model.",
    whenToUse:
      "First stage of a clone; every later stage reads what it writes.",
  },
  {
    slug: "replica-architect",
    description: "Pick the stack, write the schema and API, order the build.",
    whenToUse: "After recon.",
  },
  {
    slug: "replica-design",
    description: "Rebuild the design system and write the tokens.",
    whenToUse: "Before the screens.",
  },
  {
    slug: "replica-build",
    description: "Rebuild the screens one at a time, every state.",
    whenToUse: "After design.",
  },
  {
    slug: "replica-backend",
    description: "Auth, database, payments, email, integrations, security.",
    whenToUse: "Alongside the build.",
  },
  {
    slug: "replica-test",
    description: "Test plan, automation, bug reports in a fixed format.",
    whenToUse: "After the screens exist.",
  },
  {
    slug: "replica-review-research",
    description:
      "Collect public reviews, rank them into themes, plan the fixes.",
    whenToUse: "Before the diff; it finds why a copy should exist.",
  },
  {
    slug: "replica-diff",
    description:
      "Measure feature, layout and behaviour parity; give a verdict.",
    whenToUse: "After the build.",
  },
  {
    slug: "replica-brand",
    description: "Name, palette, logo brief, leftover sweep.",
    whenToUse: "Before launch.",
  },
  {
    slug: "replica-launch",
    description: "Landing page, pricing, store listing, launch plan.",
    whenToUse: "After brand.",
  },
  {
    slug: "replica-deploy",
    description: "Preflight, production services, domain, monitoring.",
    whenToUse: "Last stage.",
  },
];

/**
 * The masseater skills that only apply to a particular kind of task.
 *
 * The always-on engineering discipline is already in the system prompt, so it
 * is not repeated here. These two are situational: one is used when the user
 * asks for an agent skill to be written, the other when the user asks whether
 * a setup or migration is actually finished.
 */
const MASSEATER_SKILL_CATALOG: readonly BuiltinSkill[] = [
  {
    slug: "skill-authoring",
    description:
      "Write a skill, an agent instruction file, or a rules document another agent reads.",
    whenToUse: "When the user asks for one.",
  },
  {
    slug: "setup-template",
    description:
      "Judge each element - present, working, old shape gone - and prove it with the real thing.",
    whenToUse: "When the user asks whether a setup or migration is finished.",
  },
];

/**
 * Every built-in skill, in the order a reader should meet them: the Replica
 * pack in stage order, then the situational masseater skills.
 */
export const BUILTIN_SKILL_CATALOG: readonly BuiltinSkill[] = [
  ...REPLICA_SKILL_CATALOG,
  ...MASSEATER_SKILL_CATALOG,
];

/**
 * The slugs of every built-in skill. The slash-command resolver uses this to
 * tell a built-in skill apart from a user's own prompt.
 */
export const BUILTIN_SKILL_SLUGS: readonly string[] = BUILTIN_SKILL_CATALOG.map(
  (skill) => skill.slug,
);
