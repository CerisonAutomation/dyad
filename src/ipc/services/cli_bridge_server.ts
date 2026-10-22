import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { app, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import log from "electron-log/main";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import {
  getRegisteredIpcContracts,
  invokeRegisteredIpcHandler,
} from "@/ipc/handlers/base";
import { getUserDataPath } from "@/paths/paths";

/** Default TCP port the Dyad CLI bridge listens on (loopback only). */
export const DYAD_CLI_BRIDGE_DEFAULT_PORT = 39217;

/** Name of the discovery file written into the user-data directory. */
export const DYAD_CLI_BRIDGE_FILE_NAME = "dyad-cli.json";

/** Header the CLI must send on every authenticated request. */
const DYAD_CLI_BRIDGE_TOKEN_HEADER = "x-dyad-token";

/** Hard cap on a single request body (32 MB). Larger bodies are rejected. */
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

const defaultLogger = log.scope("dyad-cli-bridge");

export interface DyadCliBridgeLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface DyadCliBridgeHandle {
  /** The actual bound TCP port (resolved, so `port: 0` works). */
  port: number;
  /** The bearer-ish token the CLI must present. */
  token: string;
  /** Absolute path of the discovery file. */
  filePath: string;
  /** Stops the server and removes the discovery file. */
  close(): Promise<void>;
}

export interface DyadCliBridgeOptions {
  /** Port to bind. `0` binds an ephemeral port. Defaults to the env override. */
  port?: number;
  /** Directory that holds the discovery file. Defaults to the user-data dir. */
  userDataPath?: string;
  /** Resolves the `sender` handed to IPC handlers (usually the main window). */
  getSender?: () => unknown;
  /** Logger to use. Defaults to the scoped `electron-log/main` logger. */
  logger?: DyadCliBridgeLogger;
}

export interface BridgeCommandDescriptor {
  channel: string;
  group: string;
  description: string;
  inputKeys: string[];
  outputKeys: string[];
}

interface BridgeErrorPayload {
  kind: string;
  message: string;
  name?: string;
}

/**
 * Absolute path of the bridge discovery file.
 *
 * The CLI reads this file to learn the port and the token of the running app.
 */
export function dyadCliBridgeFilePath(userDataPath?: string): string {
  return path.join(
    userDataPath ?? getUserDataPath(),
    DYAD_CLI_BRIDGE_FILE_NAME,
  );
}

/** The channel group is the part of the channel before the first ":". */
function channelGroup(channel: string): string {
  const separatorIndex = channel.indexOf(":");
  if (separatorIndex <= 0) return "other";
  return channel.slice(0, separatorIndex);
}

/**
 * Duck-typed ZodObject detection: zod exposes the raw shape on `.shape`.
 * We intentionally avoid importing zod internals so the bridge keeps working
 * across zod versions.
 */
function schemaKeys(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return [];
  return Object.keys(shape as Record<string, unknown>);
}

function schemaDescription(schema: unknown): string {
  if (typeof schema !== "object" || schema === null) return "";
  const description = (schema as { description?: unknown }).description;
  return typeof description === "string" ? description : "";
}

/** Lists every registered IPC contract as a CLI-friendly descriptor. */
export function listDyadCliBridgeCommands(): BridgeCommandDescriptor[] {
  const commands: BridgeCommandDescriptor[] = [];
  for (const [channel, contract] of getRegisteredIpcContracts()) {
    commands.push({
      channel,
      group: channelGroup(channel),
      description: schemaDescription(contract.input),
      inputKeys: schemaKeys(contract.input),
      outputKeys: schemaKeys(contract.output),
    });
  }
  commands.sort((left, right) => left.channel.localeCompare(right.channel));
  return commands;
}

/** Constant-time token comparison (SHA-256 digests keep the lengths equal). */
function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

function errorPayload(
  kind: string,
  message: string,
  name?: string,
): { ok: false; error: BridgeErrorPayload } {
  return {
    ok: false,
    error: name ? { kind, message, name } : { kind, message },
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload ?? null);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

type BodyResult =
  | { ok: true; text: string }
  | { ok: false; tooLarge: true }
  | { ok: false; tooLarge: false };

/**
 * Reads the request body, refusing anything over the hard limit.
 * An oversized body is drained (not destroyed) so the 413 response can still
 * be delivered on the same connection.
 */
function readRequestBody(request: IncomingMessage): Promise<BodyResult> {
  return new Promise<BodyResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        request.resume();
        resolve({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, text: Buffer.concat(chunks).toString("utf8") });
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function parseJsonBody(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  if (text.trim().length === 0) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serializes a handler failure into the bridge's error envelope. */
function describeHandlerError(error: unknown): BridgeErrorPayload {
  if (isDyadError(error)) {
    return {
      kind: error.kind,
      message: error.message,
      name: error.name,
    };
  }
  if (error instanceof Error) {
    return {
      kind: DyadErrorKind.Unknown,
      message: error.message,
      name: error.name,
    };
  }
  return {
    kind: DyadErrorKind.Unknown,
    message: String(error),
    name: "Error",
  };
}

function defaultGetSender(): unknown {
  try {
    const windows = BrowserWindow?.getAllWindows?.() ?? [];
    for (const window of windows) {
      if (typeof window.isDestroyed === "function" && window.isDestroyed()) {
        continue;
      }
      return window.webContents;
    }
  } catch {
    // Fall through: the synthetic event simply carries no sender.
  }
  return undefined;
}

function resolveAppVersion(): string | undefined {
  try {
    // `app.getVersion()` reads the packaged app's version and falls back to
    // package.json in development.
    const version = app?.getVersion?.();
    return typeof version === "string" && version.length > 0
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Starts the Dyad CLI bridge: a loopback-only HTTP server that exposes every
 * registered IPC contract channel to an external CLI.
 *
 * The bridge is strictly optional. If the port cannot be bound the function
 * returns `null` and the app keeps running.
 */
export async function startDyadCliBridge(
  options: DyadCliBridgeOptions = {},
): Promise<DyadCliBridgeHandle | null> {
  const logger = options.logger ?? defaultLogger;
  const requestedPort =
    options.port ??
    (Number(process.env.DYAD_CLI_BRIDGE_PORT) || DYAD_CLI_BRIDGE_DEFAULT_PORT);
  const token = randomBytes(24).toString("hex");
  const filePath = dyadCliBridgeFilePath(options.userDataPath);
  const getSender = options.getSender ?? defaultGetSender;

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(requestedPort, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
  } catch (error) {
    logger.warn(
      `Dyad CLI bridge could not listen on 127.0.0.1:${requestedPort}; the CLI bridge stays disabled.`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : requestedPort;

  const startedAt = new Date().toISOString();
  const version = resolveAppVersion();
  const discoveryPayload: Record<string, unknown> = {
    port,
    pid: process.pid,
    token,
    app: "dyad",
    startedAt,
  };
  if (version) {
    discoveryPayload.version = version;
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(discoveryPayload, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    // `mode` only applies when the file is created; force it for a leftover file.
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    logger.warn(
      "Dyad CLI bridge could not write its discovery file; the CLI will not be able to auto-discover the bridge.",
      error instanceof Error ? error.message : String(error),
    );
  }

  logger.info(`Dyad CLI bridge listening on 127.0.0.1:${port}.`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as { pid?: unknown };
        // Only remove the file if it still describes this process; a newer
        // Dyad instance may already have taken over the port.
        if (parsed?.pid === process.pid) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      logger.warn(
        "Dyad CLI bridge could not remove its discovery file.",
        error instanceof Error ? error.message : String(error),
      );
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
      // Keep-alive sockets would otherwise keep close() pending forever.
      server.closeAllConnections();
    });
  };

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const pathname = (request.url ?? "/").split("?")[0];

    if (
      pathname !== "/health" &&
      pathname !== "/commands" &&
      pathname !== "/call" &&
      pathname !== "/call-batch"
    ) {
      sendJson(
        response,
        404,
        errorPayload("not_found", `Unknown endpoint ${pathname}.`),
      );
      return;
    }

    if (
      pathname !== "/health" &&
      !tokenMatches(
        token,
        request.headers[DYAD_CLI_BRIDGE_TOKEN_HEADER] as string | undefined,
      )
    ) {
      sendJson(
        response,
        401,
        errorPayload("unauthorized", "Invalid or missing x-dyad-token header."),
      );
      return;
    }

    const method = (request.method ?? "GET").toUpperCase();
    const expectedMethod =
      pathname === "/health" || pathname === "/commands" ? "GET" : "POST";
    if (method !== expectedMethod) {
      sendJson(
        response,
        405,
        errorPayload(
          "validation",
          `Method ${method} is not allowed for ${pathname}; use ${expectedMethod}.`,
        ),
      );
      return;
    }

    try {
      if (pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          app: "dyad",
          pid: process.pid,
          port,
          commands: getRegisteredIpcContracts().size,
        });
        return;
      }

      if (pathname === "/commands") {
        sendJson(response, 200, {
          ok: true,
          commands: listDyadCliBridgeCommands(),
        });
        return;
      }

      const body = await readRequestBody(request);
      if (!body.ok) {
        if (body.tooLarge) {
          sendJson(
            response,
            413,
            errorPayload(
              "validation",
              `Request body exceeds the ${MAX_REQUEST_BODY_BYTES} byte limit.`,
            ),
          );
          return;
        }
        sendJson(
          response,
          400,
          errorPayload("validation", "Could not read the request body."),
        );
        return;
      }

      const parsed = parseJsonBody(body.text);
      if (!parsed.ok) {
        sendJson(
          response,
          400,
          errorPayload("validation", "Request body must be valid JSON."),
        );
        return;
      }

      if (pathname === "/call") {
        if (
          !isRecord(parsed.value) ||
          typeof parsed.value.channel !== "string"
        ) {
          sendJson(
            response,
            400,
            errorPayload(
              "validation",
              'Request body must be an object with a string "channel" field.',
            ),
          );
          return;
        }
        const result = await executeSingleCall(parsed.value, getSender);
        sendJson(response, 200, result);
        return;
      }

      if (!isRecord(parsed.value) || !Array.isArray(parsed.value.calls)) {
        sendJson(
          response,
          400,
          errorPayload(
            "validation",
            'Request body must be an object with a "calls" array.',
          ),
        );
        return;
      }

      const result = await executeBatch(parsed.value.calls, getSender);
      sendJson(response, 200, result);
    } catch (error) {
      logger.error(
        "Dyad CLI bridge failed to handle a request.",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      sendJson(
        response,
        500,
        errorPayload(
          "unknown",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  return { port, token, filePath, close };
}

/** Runs a single `{ channel, input? }` call against the contract registry. */
async function executeSingleCall(
  body: Record<string, unknown>,
  getSender: () => unknown,
): Promise<
  { ok: true; result: unknown } | { ok: false; error: BridgeErrorPayload }
> {
  const channel = body.channel as string;
  const input = body.input === undefined ? {} : body.input;
  try {
    const result = await invokeRegisteredIpcHandler(channel, input, {
      sender: getSender(),
    } as Partial<IpcMainInvokeEvent>);
    return { ok: true, result: result ?? null };
  } catch (error) {
    return { ok: false, error: describeHandlerError(error) };
  }
}

/** Runs a batch of calls; each call is independent. */
async function executeBatch(
  calls: unknown[],
  getSender: () => unknown,
): Promise<{
  ok: true;
  results: Array<
    { ok: true; result: unknown } | { ok: false; error: BridgeErrorPayload }
  >;
}> {
  const results: Array<
    { ok: true; result: unknown } | { ok: false; error: BridgeErrorPayload }
  > = [];
  for (const call of calls) {
    if (!isRecord(call) || typeof call.channel !== "string") {
      results.push(
        errorPayload(
          "validation",
          'Each call must be an object with a string "channel" field.',
        ),
      );
      continue;
    }
    results.push(await executeSingleCall(call, getSender));
  }
  return { ok: true, results };
}
