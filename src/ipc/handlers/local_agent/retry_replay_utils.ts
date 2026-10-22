/**
 * Utilities for building replay messages when retrying after a transient
 * stream termination. Extracted for testability.
 */

import type { ModelMessage, UserModelMessage } from "ai";
import { pruneRootMessages } from "./subagents/subagent_context_budget";

export type RetryReplayEvent =
  | { type: "injected-user-message"; message: UserModelMessage }
  | {
      type: "assistant-text";
      text: string;
    }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

/**
 * Cache of serialized tool-result outputs, keyed by the output object.
 *
 * `buildRetryReplayMessages` runs twice over the same event list - once for
 * the model-visible history and once for the persisted transcript - and each
 * run used to JSON.stringify every tool output again. That produced two
 * independent copies of every tool result (a 256 KB read_file result became
 * ~1 MB), doubled the memory cost of every retry, and made the persisted
 * transcript burn its 10 MB budget twice as fast.
 *
 * The cache is keyed by the output object itself, so it lives exactly as
 * long as the event that owns it.
 */
const serializedToolOutputs = new WeakMap<
  object,
  { type: "text"; value: string }
>();

/**
 * Budget for the retained replay payload of one attempt.
 *
 * The replay events keep every tool CALL INPUT and tool OUTPUT of the
 * attempt so a retried pass can resume from where it stopped. An attempt can
 * run up to 100 steps, and a single `write_file` input has no size cap, so
 * the array could retain well over 100 MB for the life of the attempt - in
 * the main process, whose V8 heap cage is shared with every worker thread.
 */
const MAX_REPLAY_EVENT_BYTES = 2 * 1024 * 1024;

/** Running retained size per replay-event array. */
const replayEventBytes = new WeakMap<RetryReplayEvent[], { bytes: number }>();

function measureReplayEvent(event: RetryReplayEvent): number {
  if (event.type === "tool-call") {
    return measureValueBytes(event.input);
  }
  if (event.type === "tool-result") {
    return measureValueBytes(event.output);
  }
  if (event.type === "assistant-text") {
    return event.text.length;
  }
  return measureValueBytes(event.message);
}

function measureValueBytes(value: unknown): number {
  if (value === null || value === undefined) {
    return 8;
  }
  if (typeof value === "string") {
    return value.length;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return 8;
  }
  if (Array.isArray(value)) {
    let total = 2;
    for (const item of value) {
      total += measureValueBytes(item) + 1;
    }
    return total;
  }
  if (typeof value === "object") {
    let total = 2;
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      total += key.length + measureValueBytes(item) + 1;
    }
    return total;
  }
  return 8;
}

/**
 * Drop the oldest replay events until the retained payload fits the budget.
 *
 * Dropping an event can orphan its pair; `buildRetryReplayMessages` already
 * skips tool exchanges that lack a call or a result, so the replay stays
 * well-formed - it just resumes from a slightly earlier point.
 */
export function boundRetryReplayEvents(
  retryReplayEvents: RetryReplayEvent[],
): void {
  const counter = replayEventBytes.get(retryReplayEvents);
  if (!counter) {
    return;
  }
  while (
    retryReplayEvents.length > 0 &&
    counter.bytes > MAX_REPLAY_EVENT_BYTES
  ) {
    const removed = retryReplayEvents.shift();
    if (!removed) break;
    counter.bytes -= measureReplayEvent(removed);
  }
}

export function toToolResultOutput(value: unknown): {
  type: "text";
  value: string;
} {
  if (typeof value === "string") {
    return { type: "text", value };
  }
  if (value !== null && typeof value === "object") {
    const cached = serializedToolOutputs.get(value);
    if (cached) {
      return cached;
    }
    const serialized = serializeToolResultOutput(value);
    serializedToolOutputs.set(value, serialized);
    return serialized;
  }
  return serializeToolResultOutput(value);
}

function serializeToolResultOutput(value: unknown): {
  type: "text";
  value: string;
} {
  try {
    return { type: "text", value: JSON.stringify(value) };
  } catch {
    return { type: "text", value: String(value) };
  }
}

function trackReplayEventBytes(
  retryReplayEvents: RetryReplayEvent[],
  event: RetryReplayEvent,
): void {
  const counter = replayEventBytes.get(retryReplayEvents) ?? { bytes: 0 };
  counter.bytes += measureReplayEvent(event);
  replayEventBytes.set(retryReplayEvents, counter);
  boundRetryReplayEvents(retryReplayEvents);
}

export function maybeCaptureRetryReplayEvent(
  retryReplayEvents: RetryReplayEvent[],
  part: unknown,
): void {
  if (
    !part ||
    typeof part !== "object" ||
    !("type" in part) ||
    typeof (part as Record<string, unknown>).type !== "string"
  ) {
    return;
  }

  const record = part as Record<string, unknown>;

  if (
    record.type === "tool-call" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string"
  ) {
    if (
      retryReplayEvents.some(
        (event) =>
          event.type === "tool-call" && event.toolCallId === record.toolCallId,
      )
    ) {
      return;
    }

    const event: RetryReplayEvent = {
      type: "tool-call",
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      input:
        typeof record.input === "object" && record.input !== null
          ? record.input
          : {},
    };
    retryReplayEvents.push(event);
    trackReplayEventBytes(retryReplayEvents, event);
    return;
  }

  if (
    record.type === "tool-result" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string"
  ) {
    if (
      retryReplayEvents.some(
        (event) =>
          event.type === "tool-result" &&
          event.toolCallId === record.toolCallId,
      )
    ) {
      return;
    }

    const event: RetryReplayEvent = {
      type: "tool-result",
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      output: record.output,
    };
    retryReplayEvents.push(event);
    trackReplayEventBytes(retryReplayEvents, event);
  }
}

export function maybeCaptureRetryReplayText(
  retryReplayEvents: RetryReplayEvent[] | null,
  text: string,
): void {
  if (!retryReplayEvents || text.length === 0) {
    return;
  }

  const lastEvent = retryReplayEvents[retryReplayEvents.length - 1];
  if (lastEvent?.type === "assistant-text") {
    lastEvent.text += text;
    return;
  }

  const event: RetryReplayEvent = {
    type: "assistant-text",
    text,
  };
  retryReplayEvents.push(event);
  trackReplayEventBytes(retryReplayEvents, event);
}

/**
 * Builds replay messages from captured stream events for retry after a
 * transient stream termination. Only includes completed tool exchanges
 * (tool-call + tool-result pairs).
 */
export function buildRetryReplayMessages(
  retryReplayEvents: RetryReplayEvent[],
): ModelMessage[] {
  const replayMessages: ModelMessage[] = [];
  const pendingAssistantParts: Array<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }
  > = [];
  const toolCallsWithResult = new Set<string>();
  const toolResultsWithCall = new Set<string>();

  for (const event of retryReplayEvents) {
    if (event.type === "tool-call") {
      toolResultsWithCall.add(event.toolCallId);
      continue;
    }
    if (event.type === "tool-result") {
      toolCallsWithResult.add(event.toolCallId);
    }
  }

  const completedToolExchangeIds = new Set(
    [...toolCallsWithResult].filter((toolCallId) =>
      toolResultsWithCall.has(toolCallId),
    ),
  );

  const flushPendingAssistantMessage = () => {
    if (pendingAssistantParts.length === 0) {
      return;
    }
    replayMessages.push({
      role: "assistant",
      content: [...pendingAssistantParts],
    });
    pendingAssistantParts.length = 0;
  };

  for (const event of retryReplayEvents) {
    if (event.type === "injected-user-message") {
      flushPendingAssistantMessage();
      replayMessages.push(event.message);
      continue;
    }
    if (event.type === "assistant-text") {
      if (!event.text.trim()) {
        continue;
      }
      pendingAssistantParts.push({ type: "text", text: event.text });
      continue;
    }

    if (event.type === "tool-call") {
      if (!completedToolExchangeIds.has(event.toolCallId)) {
        continue;
      }
      pendingAssistantParts.push({
        type: "tool-call",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      });
      continue;
    }

    if (!completedToolExchangeIds.has(event.toolCallId)) {
      continue;
    }
    flushPendingAssistantMessage();
    // Merge consecutive tool-result messages so parallel tool results stay
    // grouped with the preceding assistant message's tool-call blocks.
    // The Anthropic API requires every tool_use in an assistant message to
    // have its tool_result in the immediately following message.
    const lastReplayMsg = replayMessages[replayMessages.length - 1];
    if (
      lastReplayMsg?.role === "tool" &&
      Array.isArray(lastReplayMsg.content)
    ) {
      lastReplayMsg.content.push({
        type: "tool-result",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: toToolResultOutput(event.output),
      });
    } else {
      replayMessages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            output: toToolResultOutput(event.output),
          },
        ],
      });
    }
  }
  flushPendingAssistantMessage();

  return replayMessages;
}

export function maybeAppendRetryReplayForRetry(params: {
  retryReplayEvents: RetryReplayEvent[];
  currentMessageHistoryRef: ModelMessage[];
  accumulatedAiMessagesRef: ModelMessage[];
  onCurrentMessageHistoryUpdate: (next: ModelMessage[]) => void;
}) {
  const {
    retryReplayEvents,
    currentMessageHistoryRef,
    accumulatedAiMessagesRef,
    onCurrentMessageHistoryUpdate,
  } = params;

  const replayMessages = buildRetryReplayMessages(retryReplayEvents);

  if (replayMessages.length === 0) {
    return;
  }

  // The replay carries the raw tool call inputs and tool outputs of the
  // attempt. Append it with the same context budget the turn uses, otherwise a
  // retried pass re-sends an unbounded transcript on every following step.
  const boundedReplayMessages = pruneRootMessages(replayMessages);

  onCurrentMessageHistoryUpdate([
    ...currentMessageHistoryRef,
    ...boundedReplayMessages,
  ]);
  // Injections include synthetic instructions that belong only to this turn.
  accumulatedAiMessagesRef.push(
    ...pruneRootMessages(
      buildRetryReplayMessages(
        retryReplayEvents.filter(
          (event) => event.type !== "injected-user-message",
        ),
      ),
    ),
  );
}
