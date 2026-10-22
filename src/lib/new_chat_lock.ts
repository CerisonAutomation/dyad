/**
 * Guards the "New chat" action against bursts of clicks (or key auto-repeat on
 * a focused button). Without a latch, every invocation creates its own empty
 * chat — a burst of 24 clicks leaves 24 dead chats behind.
 *
 * Shared across components on purpose: the "New chat" button lives in both the
 * chat list and the chat header, and a burst can hit either.
 */
let inFlight = false;

/** Returns false when another "New chat" is already being created. */
export function beginNewChat(): boolean {
  if (inFlight) return false;
  inFlight = true;
  return true;
}

export function endNewChat(): void {
  inFlight = false;
}
