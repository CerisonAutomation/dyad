/**
 * Skill-authoring rules for the local agent, encoded from the
 * `skill-authoring` skill (masseater/skills).
 *
 * Why this exists: an agent asked to write an agent skill fills the gaps the
 * request left with its own general knowledge and with the shape of documents
 * it has seen. Those filled-in lines then read to the next agent as the
 * requester's own judgement, and nobody can tell them apart. These rules
 * make the difference visible: the skill carries the judgement it was given,
 * and says plainly what it does not know.
 *
 * Applies when the user asks for a skill, an agent instruction file, a
 * reusable prompt, or a rules document that another agent will read.
 */

export const SKILL_AUTHORING_BLOCK = `<skill_authoring>
These rules apply when you write a skill, an agent instruction file, or a rules document that another agent will read.

- **Derive the body from why it is needed and the state it should reach.** A skill that opens with a list of tips has no way to decide an unlisted case. Write the reason it exists and the state it produces first, then let the rules follow from them. If you cannot state the mechanism behind the problem, the skill is not ready to be written.
- **Write the requester's judgement, not your own.** Where the request left a gap, do not fill it with general knowledge or with the shape of documents you have seen. Those lines read to the next agent as the requester's judgement. Either leave the gap visible, or make a proposal and let the requester correct it.
- **Put the reason next to the rule it justifies.** A rule without a reason is one the reader has to re-derive, and one they will re-derive differently.
- **Write what to do, not what to avoid.** "Do not write X" leaves the choice open; "write Y instead" closes it. Name the specific shape you want rejected rather than a general category.
- **One document carries one kind of content.** Keep the rules and the reasoning in one place, the procedures in another, and the repository-specific detail in a third. A reader who has to switch reading modes mid-document stops trusting the structure.
- **Delegate by name, do not restate.** When a rule belongs to another skill or document, point at it by name. A restatement becomes a second copy that drifts.
- **Encode repeated instructions as structure.** If the same instruction would be written twice, make it a lint rule, a type, a check, or a script. Prose that repeats is a rule nothing enforces.
- **Ask through drafts and reactions.** Offer a concrete proposal rather than an open question about preference. A person often cannot state their judgement until they react to something specific, and a draft is what they can react to.
- **Keep the frontmatter small.** The name matches the directory and the first heading. The description says what it does and when to use it, using the words a reader would search for. Do not put a table of contents in the description - it needs rewriting every time the document grows.
- **Do not duplicate what the code already carries.** File paths, function names, and defaults a reader can derive from the code go stale. A document that repeats them becomes wrong without anyone noticing.
</skill_authoring>`;
