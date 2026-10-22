import { describe, expect, it } from "vitest";
import {
  releasePreviewBrowserForApp,
  setPreviewBrowserReleaser,
} from "./preview_browser_cleanup";
import { addLog, getLogs, releaseLogs } from "@/lib/log_store";

/**
 * A Playwright Chromium was launched per app the agent drove and was only
 * ever closed when Dyad quit - roughly 150-300 MB of RSS per app for the
 * rest of the session.
 */
describe("preview browser release registry", () => {
  it("releases the session of a stopped app", () => {
    const released: number[] = [];
    setPreviewBrowserReleaser((appId) => {
      released.push(appId);
    });

    releasePreviewBrowserForApp(7);
    releasePreviewBrowserForApp(9);

    expect(released).toEqual([7, 9]);
  });

  it("is a no-op when no releaser was registered", () => {
    // A fresh module state has no releaser; calling it must not throw.
    expect(() => releasePreviewBrowserForApp(1)).not.toThrow();
  });
});

/**
 * The per-app log buffer was bounded, but the map KEY was not: the buffer
 * was only dropped on explicit user actions, so every app that was ever run
 * kept up to 1000 console entries resident.
 */
describe("log store release", () => {
  it("drops the buffer of an app whose runtime is gone", () => {
    addLog({
      appId: 42,
      level: "info",
      type: "server",
      message: "hello",
      timestamp: 1,
    });
    expect(getLogs(42)).toHaveLength(1);

    releaseLogs(42);

    expect(getLogs(42)).toHaveLength(0);
  });

  it("keeps the buffer of other apps", () => {
    addLog({
      appId: 1,
      level: "info",
      type: "server",
      message: "a",
      timestamp: 1,
    });
    addLog({
      appId: 2,
      level: "info",
      type: "server",
      message: "b",
      timestamp: 2,
    });

    releaseLogs(1);

    expect(getLogs(1)).toHaveLength(0);
    expect(getLogs(2)).toHaveLength(1);
    releaseLogs(2);
  });
});
