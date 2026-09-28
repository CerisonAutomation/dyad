import { describe, expect, it } from "vitest";
import { spawnWithBadFdRetry } from "./spawn_retry";

/**
 * spawn_retry proxies a real child process so it can retry when macOS's
 * background-suspend closes the app's file descriptors. Two defects were fixed
 * here and are pinned below:
 *
 *  1. The proxy never exposed `pid`, so spawn_streaming's `treeKill()` fell
 *     through to a no-op and every abort orphaned its process tree.
 *  2. A failed spawn emits `error` then `close`; marking the attempt settled on
 *     that `close` cancelled the retry the `error` had just scheduled, so the
 *     retry never ran at all.
 */
describe("spawnWithBadFdRetry", () => {
  it("exposes the real child pid", async () => {
    const child = spawnWithBadFdRetry("/bin/sleep", ["5"], {});
    await new Promise((r) => setTimeout(r, 300));
    expect(child.pid).toBeTypeOf("number");
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    child.kill("SIGKILL");
  });

  it("kill() reaches the real process", async () => {
    const child = spawnWithBadFdRetry("/bin/sleep", ["30"], {});
    await new Promise((r) => setTimeout(r, 300));
    const pid = child.pid!;
    expect(pid).toBeTypeOf("number");
    child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 400));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("pipes stdout through the proxy", async () => {
    const child = spawnWithBadFdRetry("/bin/echo", ["hello-proxy"], {});
    let out = "";
    child.stdout!.on("data", (d) => {
      out += d.toString();
    });
    await new Promise((r) => child.on("close", r));
    expect(out.trim()).toBe("hello-proxy");
  });

  it("pipes stderr through the proxy", async () => {
    const child = spawnWithBadFdRetry("/bin/sh", ["-c", "echo oops 1>&2"], {});
    let err = "";
    child.stderr!.on("data", (d) => {
      err += d.toString();
    });
    await new Promise((r) => child.on("close", r));
    expect(err.trim()).toBe("oops");
  });

  it("forwards exit and close events", async () => {
    const child = spawnWithBadFdRetry("/usr/bin/true", [], {});
    const code = await new Promise<number | null>((r) => {
      child.on("close", (c) => r(c as number));
    });
    expect(code).toBe(0);
  });

  it("surfaces a non-EBADF spawn failure once, without retrying", async () => {
    const child = spawnWithBadFdRetry("/nonexistent/binary-xyz", [], {});
    let errors = 0;
    child.on("error", () => {
      errors += 1;
    });
    await new Promise((r) => setTimeout(r, 1500));
    // ENOENT is deterministic: retrying cannot help, so it must not loop.
    expect(errors).toBe(1);
  });

  it("does not throw synchronously on a bad command", () => {
    expect(() =>
      spawnWithBadFdRetry("/nonexistent/binary-xyz", [], {}),
    ).not.toThrow();
  });
});
