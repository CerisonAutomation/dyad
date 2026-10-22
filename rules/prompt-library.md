# Prompt library

The prompt library is `src/prompts/`. It carries the agent's instructions,
and every block in it is paid for on every turn of every conversation.

## What goes where

- **Always-on discipline** - the engineering principles, the React guidance,
  the communication rules - lives in the system prompt. These apply to every
  change the agent makes, so a turn that omits them is a turn where the agent
  works without them.
- **Situational skills** - the Replica pack, `setup-template`,
  `skill-authoring` - are _not_ in the system prompt. They apply to a small
  fraction of requests and are long; the Replica pack alone is roughly
  twenty-nine kilobyte. They are listed in the skill catalog and their bodies
  arrive with the message that invokes them, through the `/<slug>` command.

## One source of truth

`src/prompts/builtin_skills/catalog.ts` names every built-in skill and the
slug that invokes it. `src/prompts/builtin_skills/content.ts` holds the
bodies. A skill that is not in the catalog cannot be invoked, and a body with
no catalog entry is dead weight - `builtin_skills.test.ts` fails on either
mistake. When you add a skill, add it to both.

The catalog is metadata only so the renderer can offer the slash commands
without pulling the bodies into the renderer bundle. Keep it that way.

## The Replica pack is conditional

The pack is a staged project, so it is loaded for the whole conversation, not
for the turn that happened to mention a clone. `isCloneWorkflowConversation`
checks the conversation's _user_ messages: the agent's own replies talk about
clones constantly once the workflow is running, so counting them would turn
every conversation into a clone conversation.

A prompt variant takes the pack through the `isCloneWorkflow` option. It is
not baked into the base prompt strings, because a base prompt that carries
the pack costs every turn.

## Measuring a change

Every block added to a system prompt costs every turn. Before adding one,
measure: build the prompt and compare its length. The local-agent prompt was
about sixteen thousand tokens with the pack in it and about ten thousand
without. A block that pays for itself on the turns that need it and costs
nothing elsewhere is the goal; the catalog plus the conditional pack is how
that is done here.

## Tests

- `npm test -- src/prompts` runs the prompt tests.
- `npm test -- src/prompts -u` updates the prompt snapshots. The snapshot
  file is large and holds whole prompts, so review the diff rather than
  committing it blind.
- `src/prompts/agent_discipline_prompt.test.ts` locks the always-on rules
  into every prompt variant, and asserts that the situational skills stay out
  of the system prompt.
