import { describe, expect, it } from "vitest";

import { ToolRepeatTracker } from "./tool_repeat_tracker";

const read = (path: string) => ({ toolName: "read", input: { path } });
const grep = (pattern: string) => ({ toolName: "grep", input: { pattern } });

describe("ToolRepeatTracker", () => {
  it("stays silent below the first threshold", () => {
    const tracker = new ToolRepeatTracker();
    expect(tracker.observeStep([read("a")])).toBeUndefined();
    expect(tracker.observeStep([read("a")])).toBeUndefined();
  });

  it("emits a gentle reminder at three consecutive identical calls", () => {
    const tracker = new ToolRepeatTracker();
    tracker.observeStep([read("a")]);
    tracker.observeStep([read("a")]);
    const reminder = tracker.observeStep([read("a")]);

    expect(reminder?.tier).toBe("gentle");
    expect(reminder?.toolName).toBe("read");
    expect(reminder?.count).toBe(3);
  });

  it("escalates to detailed and final reminders at later thresholds", () => {
    const tracker = new ToolRepeatTracker();
    let last;
    for (let i = 0; i < 8; i++) {
      last = tracker.observeStep([grep("x")]);
    }

    expect(last?.tier).toBe("final");
    expect(last?.count).toBe(8);
    expect(last?.text).toContain("grep");
  });

  it("emits each threshold only once", () => {
    const tracker = new ToolRepeatTracker([2, 3]);
    expect(tracker.observeStep([read("a")])).toBeUndefined();
    expect(tracker.observeStep([read("a")])?.tier).toBe("gentle");
    expect(tracker.observeStep([read("a")])?.tier).toBe("detailed");
    expect(tracker.observeStep([read("a")])).toBeUndefined();
  });

  it("resets the streak when a different call appears", () => {
    const tracker = new ToolRepeatTracker([2]);
    tracker.observeStep([read("a")]);
    expect(tracker.observeStep([read("b")])).toBeUndefined();
    expect(tracker.observeStep([read("b")])?.tier).toBe("gentle");
  });

  it("treats argument key order as identical", () => {
    const tracker = new ToolRepeatTracker([2]);
    tracker.observeStep([{ toolName: "edit", input: { a: 1, b: 2 } }]);
    const reminder = tracker.observeStep([
      { toolName: "edit", input: { b: 2, a: 1 } },
    ]);

    expect(reminder?.tier).toBe("gentle");
  });

  it("resets on malformed calls instead of counting them", () => {
    const tracker = new ToolRepeatTracker([2]);
    tracker.observeStep([read("a")]);
    expect(tracker.observeStep([null])).toBeUndefined();
    expect(tracker.observeStep([read("a")])).toBeUndefined();
  });

  it("caps the quoted arguments in the detailed reminder", () => {
    const tracker = new ToolRepeatTracker();
    const big = "x".repeat(2000);
    let reminder;
    for (let i = 0; i < 5; i++) {
      reminder = tracker.observeStep([read(big)]);
    }

    expect(reminder?.tier).toBe("detailed");
    expect(reminder?.text.length ?? 0).toBeLessThan(2000);
    expect(reminder?.text).toContain("more chars");
  });

  it("rejects invalid threshold configuration loudly", () => {
    expect(() => new ToolRepeatTracker([])).toThrow(/must not be empty/);
    expect(() => new ToolRepeatTracker([1])).toThrow(/>= 2/);
    expect(() => new ToolRepeatTracker([2.5])).toThrow(/>= 2/);
    expect(() => new ToolRepeatTracker([3, 3])).toThrow(/duplicates/);
  });
});
