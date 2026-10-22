/**
 * Scrub provider-mangled tool-call markup out of model-authored text.
 *
 * On the local-agent path every tool is a real AI SDK tool call, and Dyad
 * renders an output card for it (`<dyad-script description="..." ...>`). When a
 * provider cannot express a tool call natively it serialises the call into the
 * assistant's *text* channel instead. MiniMax (reached through the OpenCode
 * Zen gateway) does that, and the gateway's serialisation is mangled:
 *
 *   - the tag name is followed by a stray quote (`<dyad-git_status">`), a
 *     shape no Dyad card builder emits;
 *   - the argument fields are emitted as XML child elements
 *     (`<server>dyad-repair</server>`);
 *   - the fields are separated by a provider control sequence
 *     (`]<]<model>[>[`).
 *
 * Because the local agent has no parser that turns model-emitted `<dyad-*>`
 * markup back into tool calls, that text is persisted as the assistant
 * message and rendered as visible garbage.
 *
 * Removing it here is safe for Dyad's own cards: they never travel through
 * the text channel (`commitToolXml` writes them straight into the response),
 * and a real card never carries a quote directly after its tag name.
 */

/**
 * A mangled tool-call open tag. The quote directly after the tag name is the
 * signature of the provider's mangling - Dyad's own cards always either have
 * no attributes or a `name="value"` attribute.
 */
const MALFORMED_TOOL_OPEN = /<dyad-[A-Za-z0-9_-]+"/g;

/** Any `<dyad-*` open tag, used to find the well-formed ones. */
const DYAD_OPEN = /<dyad-[A-Za-z0-9_-]+/g;

/**
 * The provider control sequence that separates the fields of a mangled tool
 * call. The middle part is the serving model family, so it is matched
 * structurally instead of by name.
 */
const PROVIDER_CONTROL_SEQUENCE =
  /\][ \t]*<\][ \t]*[^\s[\]]*[ \t]*\[>[ \t]*\[/g;

/** A closing tag, e.g. `</packages>`. */
const CLOSE_TAG = /<\/[A-Za-z0-9_-]*[ \t]*>/g;

/**
 * A markup token: either a tag or a provider control sequence. Used to walk
 * the tail of a mangled block, where the remaining argument fields are
 * emitted as tag pairs.
 */
const MARKUP_TOKEN =
  /\][ \t]*<\][ \t]*[^\s[\]]*[ \t]*\[>[ \t]*\[|<\/?[A-Za-z0-9_.-]+(?:[ \t][^<>]*?)?\/?>/g;

/** Thinking blocks are model prose, never part of a mangled tool call. */
const THINK_TAG = /<\/?think>/i;

export interface ModelToolMarkupScrubResult {
  /** Scrubbed text that is safe to append to the assistant response. */
  emit: string;
  /**
   * Trailing text that was held back because it may still turn into a
   * mangled block once the next chunk arrives.
   */
  pending: string;
}

/**
 * Remove mangled tool-call markup from model-authored text.
 *
 * `pending` is the text the previous call held back. Prepending it to the
 * newly arrived text means a tag split across two chunks is still recognized.
 * `final` marks the end of a step: any text still held back is then released.
 */
export function scrubModelToolMarkup(
  text: string,
  options: { pending?: string; final?: boolean } = {},
): ModelToolMarkupScrubResult {
  const final = options.final === true;
  const buffer = (options.pending ?? "") + text;
  let emit = "";
  let pos = 0;
  let pendingStart = -1;

  MALFORMED_TOOL_OPEN.lastIndex = 0;
  for (
    let match = MALFORMED_TOOL_OPEN.exec(buffer);
    match;
    match = MALFORMED_TOOL_OPEN.exec(buffer)
  ) {
    const blockStart = match.index;
    const blockEnd = findBlockEnd(buffer, match.index + match[0].length, final);
    if (blockEnd === null) {
      // The block is not terminated yet - hold it back until more text
      // arrives so the whole call is removed in one piece.
      pendingStart = blockStart;
      break;
    }
    emit += buffer.slice(pos, blockStart);
    pos = blockEnd;
    MALFORMED_TOOL_OPEN.lastIndex = blockEnd;
  }

  let pending: string;
  if (pendingStart === -1) {
    const rest = buffer.slice(pos);
    // Hold back a trailing `<dyad-name` prefix that could still become a
    // mangled open tag once the next chunk arrives.
    const hold = final ? 0 : partialOpenLength(rest);
    emit += rest.slice(0, rest.length - hold);
    pending = rest.slice(rest.length - hold);
  } else {
    emit += buffer.slice(pos, pendingStart);
    pending = buffer.slice(pendingStart);
  }

  return { emit: stripProviderControlSequences(emit), pending };
}

/**
 * End of a mangled tool-call block, exclusive.
 *
 * The block ends at its first closing tag. The remaining argument fields that
 * the provider emitted after it (tag pairs separated by the control sequence)
 * belong to the same call, so the walk continues over them. It stops at a
 * newline, at a thinking tag, at a well-formed Dyad card, or at the end of the
 * buffer.
 */
function findBlockEnd(
  buffer: string,
  from: number,
  final: boolean,
): number | null {
  const close = findCloseTag(buffer, from);
  const closeIndex = close ? close.index : -1;
  const card = findWellFormedDyadOpen(buffer, from);
  // A well-formed Dyad card cannot be part of a mangled block, so it ends the
  // block even when a closing tag comes later.
  if (card !== -1 && (closeIndex === -1 || card < closeIndex)) {
    return card;
  }
  if (!close) {
    if (!final) return null;
    // Nothing terminated the block: it runs to the end of the buffer (or to
    // the thinking block that follows it).
    const think = buffer.slice(from).search(THINK_TAG);
    return think === -1 ? buffer.length : from + think;
  }

  let end = closeIndex + close[0].length;
  for (;;) {
    const next = nextMarkupTokenEnd(buffer, end);
    if (next === null) break;
    end = next;
  }
  return end;
}

/**
 * End of the next markup token, exclusive, or null when the block should end.
 */
function nextMarkupTokenEnd(buffer: string, from: number): number | null {
  MARKUP_TOKEN.lastIndex = from;
  const token = MARKUP_TOKEN.exec(buffer);
  if (!token) return null;
  const gap = buffer.slice(from, token.index);
  if (gap.includes("\n")) {
    // A line break means prose started, so the block is over - unless only
    // whitespace separates the two and the next token still belongs to the
    // mangled call (the provider puts the closing marker on its own line).
    if (gap.trim() !== "") return null;
    if (token[0].startsWith("<") && !token[0].startsWith("</")) return null;
    if (token[0].startsWith("</dyad-")) return null;
  }
  // Thinking blocks are prose, not part of a tool call.
  if (THINK_TAG.test(token[0])) return null;
  // A well-formed Dyad card is never part of a mangled block.
  if (token[0].startsWith("<dyad-")) return null;
  return token.index + token[0].length;
}

/**
 * Index of the first closing tag at or after `from`, or -1.
 */
function findCloseTag(buffer: string, from: number): RegExpExecArray | null {
  CLOSE_TAG.lastIndex = from;
  return CLOSE_TAG.exec(buffer);
}

/**
 * Index of the first well-formed `<dyad-*` open tag at or after `from`, or -1.
 *
 * A well-formed open tag is one that is not followed by a stray quote - that
 * quote is what marks the provider's mangled form.
 */
function findWellFormedDyadOpen(buffer: string, from: number): number {
  DYAD_OPEN.lastIndex = from;
  for (
    let match = DYAD_OPEN.exec(buffer);
    match;
    match = DYAD_OPEN.exec(buffer)
  ) {
    if (buffer[match.index + match[0].length] !== '"') return match.index;
  }
  return -1;
}

/**
 * Length of the trailing `<dyad-name` prefix that could still become a
 * mangled open tag once more text arrives.
 */
function partialOpenLength(text: string): number {
  const index = text.lastIndexOf("<");
  if (index === -1) return 0;
  const tail = text.slice(index);
  return /^<dyad-[A-Za-z0-9_-]*$/.test(tail) ? tail.length : 0;
}

/**
 * Remove the provider control sequences that separate the fields of a mangled
 * tool call.
 */
function stripProviderControlSequences(text: string): string {
  return text.replace(PROVIDER_CONTROL_SEQUENCE, "");
}
