import { expect, it } from "vitest";
import { ToolLoopGuard } from "./tool_loop_guard";
it("blocks the fourth unchanged failed request, including alternating tool cycles", () => {
  const guard = new ToolLoopGuard();
  for (let i = 0; i < 3; i++) {
    guard.assertAllowed("build", { path: "app" });
    guard.record("build", { path: "app" }, "same compiler error", true, false);
    guard.record("read", { path: "other" }, "same diagnostics", false, false);
  }
  expect(() => guard.assertAllowed("build", { path: "app" })).toThrow(
    "Loop protection",
  );
  expect(() =>
    guard.assertAllowed("build", { path: "corrected" }),
  ).not.toThrow();
});
it("permits a check again after a distinct successful mutation", () => {
  const guard = new ToolLoopGuard();
  for (let i = 0; i < 3; i++) guard.record("build", {}, "error", true, false);
  guard.record("write_file", { content: "fix" }, "written", false, true);
  expect(() => guard.assertAllowed("build", {})).not.toThrow();
});
it("does not count changing outcomes as identical failures", () => {
  const guard = new ToolLoopGuard();
  for (let i = 0; i < 10; i++) {
    guard.assertAllowed("build", {});
    guard.record("build", {}, String(i), true, false);
  }
});
it("canonicalizes argument key ordering and protects repeated mutations", () => {
  const guard = new ToolLoopGuard();
  for (let i = 0; i < 3; i++)
    guard.record(
      "restart",
      { a: 1, nested: { z: 2, b: 3 } },
      "restarted",
      false,
      true,
    );
  expect(() =>
    guard.assertAllowed("restart", { nested: { b: 3, z: 2 }, a: 1 }),
  ).toThrow("Loop protection");
});
it("does not prevent successful read-only polling", () => {
  const guard = new ToolLoopGuard();
  for (let i = 0; i < 20; i++) {
    guard.assertAllowed("read", {});
    guard.record("read", {}, "same", false, false);
  }
});
it("bounds history and stores digests rather than sensitive input/output", () => {
  const guard = new ToolLoopGuard();
  for (let i = 0; i < 100; i++)
    guard.record(
      "read",
      { i, secret: "private-token" },
      "private-source",
      true,
      false,
    );
  const entries = Reflect.get(guard, "attempts") as Map<string, unknown>;
  expect(entries.size).toBe(64);
  expect(JSON.stringify([...entries])).not.toMatch(
    /private-token|private-source/,
  );
});
it("does not crash on unrepresentable or oversized arguments", () => {
  const guard = new ToolLoopGuard();
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const args of [cycle, { text: "a".repeat(2_000_001) }]) {
    expect(() =>
      guard.record("tool", args, "error", true, false),
    ).not.toThrow();
    expect(() => guard.assertAllowed("tool", args)).not.toThrow();
  }
});
