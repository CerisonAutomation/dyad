/**
 * When to load the Replica pack.
 *
 * The pack itself lives in `replica_skills_prompt.ts`, one exported block per
 * skill, because each stage has to be addressable on its own. This module
 * holds the intent test that decides whether a conversation is about a clone.
 *
 * The pack is a staged workflow for rebuilding an app the user's way, with
 * hard boundaries around what may be taken from the original. It is loaded
 * only when the conversation is about a clone, because the workflow is long
 * and irrelevant to every other request.
 */

const CLONE_TRIGGER_PATTERNS: RegExp[] = [
  /\bclone\s+(this|that|the)?\s*\w*\s*app\b/i,
  /\b(copy|duplicate|replicate|rebuild|recreate|mirror)\s+(this|that|the)?\s*\w*\s*app\b/i,
  /\breverse[- ]engineer\b/i,
  /\bbuild\s+my\s+own\s+(version|copy)\b/i,
  /\bclone\s+(the\s+)?(notion|calendly|trello|airbnb|uber|netflix|spotify|slack|discord|figma|linear|asana|dropbox|zoom|canva)\b/i,
  /\bmake\s+it\s+look\s+like\s+\w+/i,
  /\bmatch\s+the\s+design\s+of\b/i,
  /\bbuild\s+the\s+clone\b/i,
  /\brebuild\s+this\screen\b/i,
  /\bwhat\s+screens\s+does\b/i,
  /\bmap\s+out\s+(this|that|the)?\s*\w*\s*app\b/i,
  /\bhow\s+does\s+\w+\s+work\b.*\b(app|product)\b/i,
  /\b(replica|clone)\s+(workflow|pack)\b/i,
];

/**
 * Whether a turn is asking for an app clone. The trigger phrases come from
 * each skill's own `description`, so the agent recognises the same requests
 * the skills were written for.
 */
export function isCloneWorkflowRequest(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return CLONE_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether this conversation is running the Replica workflow.
 *
 * The pack is a project, not a request: it runs across many turns, and the
 * user answers questions between them. Testing the current turn alone would
 * drop the workflow the moment the user replied "yes, Notion, web" - so the
 * whole conversation is checked, and one turn that asks for a clone keeps the
 * pack loaded for the rest of the conversation.
 *
 * Takes an iterable and stops at the first match, so a long conversation
 * costs one message body per turn at most.
 */
export function isCloneWorkflowConversation(
  messageTexts: Iterable<string | undefined> | undefined,
): boolean {
  if (!messageTexts) {
    return false;
  }
  for (const text of messageTexts) {
    if (isCloneWorkflowRequest(text)) {
      return true;
    }
  }
  return false;
}
