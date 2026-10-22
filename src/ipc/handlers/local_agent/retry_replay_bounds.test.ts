import { describe, expect, it } from "vitest";
import {
  boundRetryReplayEvents,
  maybeCaptureRetryReplayEvent,
  type RetryReplayEvent,
} from "./retry_replay_utils";

/**
 * The replay events keep every tool input and output of an attempt so a
 * retried pass can resume. Without a budget they could retain well over
 * 100 MB for the life of the attempt.
 */
describe("boundRetryReplayEvents", () => {
  it("keeps the retained payload within the budget", () => {
    const events: RetryReplayEvent[] = [];
    // Each event carries a 1 MB output.
    for (let i = 0; i < 20; i++) {
      maybeCaptureRetryReplayEvent(events, {
        type: "tool-result",
        toolCallId: `call-${i}`,
        toolName: "read_file",
        output: { type: "text", value: "x".repeat(1_000_000) },
      });
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(20);
  });

  it("keeps the newest events and drops the oldest", () => {
    const events: RetryReplayEvent[] = [];
    for (let i = 0; i < 20; i++) {
      maybeCaptureRetryReplayEvent(events, {
        type: "tool-result",
        toolCallId: `call-${i}`,
        toolName: "read_file",
        output: { type: "text", value: "x".repeat(1_000_000) },
      });
    }

    const last = events[events.length - 1];
    expect(last?.type).toBe("tool-result");
    if (last?.type === "tool-result") {
      expect(last.toolCallId).toBe("call-19");
    }
  });

  it("leaves small event lists untouched", () => {
    const events: RetryReplayEvent[] = [];
    maybeCaptureRetryReplayEvent(events, {
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "read_file",
      output: { type: "text", value: "small" },
    });

    expect(events).toHaveLength(1);
    boundRetryReplayEvents(events);
    expect(events).toHaveLength(1);
  });
});
