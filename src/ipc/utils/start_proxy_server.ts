// startProxy.js – helper to launch proxy.js as a worker

import { Worker } from "worker_threads";
import path from "path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  PROXY_FALLBACK_MAX_ATTEMPTS,
  getProxyFallbackPortStart,
} from "../../../shared/ports";

const logger = log.scope("start_proxy_server");

export async function startProxy(
  targetOrigin: string,
  opts: {
    port: number;
    onStarted?: (proxyUrl: string) => void;
    onError?: (error: DyadError) => void;
    fixedHeaders?: Record<string, string>;
    authBootstrapToken: string;
  },
) {
  if (!/^https?:\/\//.test(targetOrigin))
    throw new DyadError(
      "startProxy: targetOrigin must be absolute http/https URL",
      DyadErrorKind.Validation,
    );
  const { port, onStarted, onError, fixedHeaders, authBootstrapToken } = opts;

  // A proxy pointed at its own port forwards to itself, so every request
  // dead-ends and surfaces as 502 / "Parse Error: Header overflow". This
  // happened when a stale dev-server command (`next dev -p 3000 ... ; true
  // --port 32115`) caused port discovery to resolve the app to the proxy's
  // own listening port. Fail loudly at construction instead.
  const targetPort = (() => {
    try {
      const parsed = new URL(targetOrigin);
      if (parsed.port) return Number(parsed.port);
      return parsed.protocol === "https:" ? 443 : 80;
    } catch {
      return undefined;
    }
  })();
  if (targetPort !== undefined && targetPort === port) {
    throw new DyadError(
      `startProxy: targetOrigin port ${targetPort} is the proxy's own ` +
        "port. The proxy cannot forward to itself; the app's port was " +
        "mis-detected.",
      DyadErrorKind.Validation,
    );
  }
  const fallbackPortStart = getProxyFallbackPortStart();
  logger.info("Starting proxy on port", port);

  const worker = new Worker(
    path.resolve(__dirname, "..", "..", "worker", "proxy_server.js"),
    {
      workerData: {
        targetOrigin,
        port,
        fallbackPortStart,
        maxPortAttempts: PROXY_FALLBACK_MAX_ATTEMPTS,
        fixedHeaders,
        authBootstrapToken,
      },
    },
  );

  worker.on("message", (m) => {
    logger.info("[proxy]", m);
    if (typeof m === "string" && m.startsWith("proxy-server-start url=")) {
      const url = m.substring("proxy-server-start url=".length);
      onStarted?.(url);
    } else if (typeof m === "string" && m.startsWith("proxy-server-error")) {
      logger.error("[proxy] failed to bind:", m);
      onError?.(
        new DyadError(
          `Could not start the preview proxy: every port from ${port} to ${fallbackPortStart + PROXY_FALLBACK_MAX_ATTEMPTS - 1} is in use. Free up a port and restart the app.`,
          DyadErrorKind.Conflict,
        ),
      );
    }
  });
  worker.on("error", (e) => logger.error("[proxy] error:", e));
  worker.on("exit", (c) => logger.info("[proxy] exit", c));

  return worker; // let the caller keep a handle if desired
}
