import { spawn, ChildProcess, type SpawnOptions } from "node:child_process";
import { PassThrough } from "node:stream";
import log from "electron-log/main";

const logger = log.scope("spawn_retry");

/**
 * macOS closes an app's file descriptors while it is suspended in the
 * background. The first `child_process.spawn` after the app wakes fails with
 * EBADF ("bad file descriptor") even though nothing is wrong with the binary
 * or the arguments — the same command spawns fine from a terminal on the same
 * machine at the same moment.
 *
 * `spawn` reports this asynchronously via the `error` event, so the retry has
 * to happen there rather than in a try/catch. EBADF is the only code retried:
 * it is the signature of this specific resume race and never indicates a real
 * fault in the command itself.
 */
const MAX_EBADF_RETRIES = 3;
// Measured: a 150ms linear backoff exhausted all three attempts before the
// app finished resuming. This window is sized to actually cover the resume.
const RETRY_BACKOFF_MS = [400, 1200, 3000];

function isBadFileDescriptorError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EBADF") return true;
  // Some paths surface the message without the errno code attached.
  return typeof error === "object" && error !== null &&
    "code" in error === false &&
    /EBADF|bad file descriptor/i.test(String((error as Error)?.message ?? ""));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StreamName = "stdin" | "stdout" | "stderr";

/**
 * Spawn `command`, transparently retrying if macOS's background-suspend closes
 * the file descriptors out from under the first attempt. The returned process
 * forwards the real child's events, so callers use it exactly as they would the
 * direct `spawn` result.
 */
export function spawnWithBadFdRetry(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  // A bare `new ChildProcess()` has null streams, so the proxy would hand
  // callers undefined and every `child.stdout.on(...)` would throw. Give it
  // real PassThrough streams and pipe the actual child into them.
  const proxy = new ChildProcess();
  const proxyStreams = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
  proxy.stdin = proxyStreams.stdin;
  proxy.stdout = proxyStreams.stdout;
  proxy.stderr = proxyStreams.stderr;
  for (const stream of Object.values(proxyStreams)) {
    stream.on("error", () => undefined);
  }

  let child: ChildProcess | null = null;
  let settled = false; // a real (non-EBADF) outcome has been observed
  let attempt = 0;

  const wire = (real: ChildProcess) => {
    child = real;
    // Expose the live pid. spawn_streaming kills process TREES via
    // treeKill(child.pid); a bare `new ChildProcess()` has pid === undefined,
    // so without this every abort/timeout silently failed to kill anything and
    // orphaned the npx/playwright/chromium children.
    Object.defineProperty(proxy, "pid", {
      get: () => child?.pid,
      configurable: true,
    });
    // `kill` on the proxy must reach the real child, not a no-op base stub.
    proxy.kill = ((signal?: NodeJS.Signals | number) =>
      child?.kill(signal as NodeJS.Signals)) as ChildProcess["kill"];
    for (const name of ["stdin", "stdout", "stderr"] as StreamName[]) {
      const source = real[name];
      const target = proxyStreams[name];
      if (!source) continue;
      source.on("error", () => undefined);
      if (name === "stdin") {
        proxyStreams.stdin.pipe(source as NodeJS.WritableStream);
      } else {
        (source as NodeJS.ReadableStream).pipe(target);
      }
    }
    // A failed spawn emits `error` THEN `close`. Marking the attempt settled
    // on `close` therefore cancelled the very retry that `error` had just
    // scheduled, so the retry never ran and callers saw a silent empty
    // result. Only a close WITHOUT a preceding error ends this attempt.
    let attemptErrored = false;
    for (const event of ["close", "exit"] as const) {
      real.on(event, (...rest: unknown[]) => {
        if (!attemptErrored) settled = true;
        // Defer the re-emit by a macrotask. A child that exits immediately
        // (e.g. /bin/true) would otherwise close the proxy before the caller
        // had a chance to attach a listener, and the event would be lost —
        // Node's own ChildProcess buffers this, the proxy must too.
        setImmediate(() => {
          (proxy.emit as (...a: unknown[]) => void)(event, ...rest);
        });
      });
    }
    real.on("error", () => {
      attemptErrored = true;
    });
  };

  const launch = () => {
    let real: ChildProcess;
    try {
      real = spawn(command, args as string[], options);
    } catch (error) {
      proxy.emit("error", error);
      return;
    }
    wire(real);

    real.on("error", (error: unknown) => {
      if (!isBadFileDescriptorError(error) || settled) {
        proxy.emit("error", error);
        return;
      }
      if (attempt >= MAX_EBADF_RETRIES) {
        proxy.emit("error", error);
        return;
      }
      attempt += 1;
      logger.warn(
        `spawn("${command}") hit EBADF; retry ${attempt}/${MAX_EBADF_RETRIES}`,
      );
      // The descriptors are still closed, so retrying immediately would fail
      // identically. Wait for the app to finish resuming first.
      void delay(RETRY_BACKOFF_MS[attempt - 1] ?? 3000).then(() => {
        if (settled) return;
        launch();
      });
    });
  };

  launch();
  return proxy;
}
