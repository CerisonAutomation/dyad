import fs from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The bridge (and `base.ts`) pull in electron / electron-log. Stub both so the
// suite loads in a headless box.
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getVersion: vi.fn(() => "0.0.0-test"),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  },
}));
vi.mock("electron-log/main", () => ({
  default: {
    scope: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  },
}));

import { defineContract } from "@/ipc/contracts/core";
import { createTypedHandler } from "@/ipc/handlers/base";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DYAD_CLI_BRIDGE_DEFAULT_PORT,
  DYAD_CLI_BRIDGE_FILE_NAME,
  dyadCliBridgeFilePath,
  startDyadCliBridge,
  type DyadCliBridgeHandle,
} from "./cli_bridge_server";

const echoContract = defineContract({
  channel: "test:echo",
  input: z.object({ value: z.string() }).describe("Echoes the value back."),
  output: z.object({ echo: z.string() }),
});

const boomContract = defineContract({
  channel: "test:boom",
  input: z.object({}),
  output: z.object({}),
});

const lonelyContract = defineContract({
  channel: "testlonely",
  input: z.string(),
  output: z.string(),
});

createTypedHandler(echoContract, async (_event, input) => ({
  echo: input.value,
}));
createTypedHandler(boomContract, async () => {
  throw new DyadError("Boom.", DyadErrorKind.Internal);
});
createTypedHandler(lonelyContract, async (_event, input) => input);

let tempDir: string;
let bridge: DyadCliBridgeHandle | null = null;

async function request(
  method: string,
  pathname: string,
  options: { token?: string | null; body?: unknown; rawBody?: string } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers["x-dyad-token"] = options.token;
  const body =
    options.rawBody !== undefined
      ? options.rawBody
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: bridge!.port,
        method,
        path: pathname,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            json: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-cli-bridge-test-"));
  bridge = await startDyadCliBridge({
    port: 0,
    userDataPath: tempDir,
    getSender: () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  expect(bridge).not.toBeNull();
});

afterEach(async () => {
  if (bridge) {
    await bridge.close();
    bridge = null;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("dyad cli bridge", () => {
  it("serves /health without a token", async () => {
    const response = await request("GET", "/health", { token: null });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);
    expect(response.json.app).toBe("dyad");
    expect(response.json.pid).toBe(process.pid);
    expect(response.json.port).toBe(bridge!.port);
    expect(response.json.commands).toBeGreaterThanOrEqual(3);
    expect(response.json.token).toBeUndefined();
  });

  it("rejects /commands without a token", async () => {
    const response = await request("GET", "/commands", { token: null });
    expect(response.status).toBe(401);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe("unauthorized");
  });

  it("rejects /commands with a wrong token", async () => {
    const response = await request("GET", "/commands", { token: "nope" });
    expect(response.status).toBe(401);
    expect(response.json.error.kind).toBe("unauthorized");
  });

  it("lists the registered commands with their group and keys", async () => {
    const response = await request("GET", "/commands", {
      token: bridge!.token,
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const commands = response.json.commands as Array<{
      channel: string;
      group: string;
      description: string;
      inputKeys: string[];
      outputKeys: string[];
    }>;
    const channels = commands.map((command) => command.channel);
    expect(channels).toContain("test:echo");
    expect(channels).toContain("test:boom");
    // Sorted by channel.
    expect([...channels].sort()).toEqual(channels);

    const echo = commands.find((command) => command.channel === "test:echo");
    expect(echo?.group).toBe("test");
    expect(echo?.description).toBe("Echoes the value back.");
    expect(echo?.inputKeys).toEqual(["value"]);
    expect(echo?.outputKeys).toEqual(["echo"]);

    const lonely = commands.find((command) => command.channel === "testlonely");
    expect(lonely?.group).toBe("other");
    expect(lonely?.inputKeys).toEqual([]);
    expect(lonely?.outputKeys).toEqual([]);
  });

  it("calls a contract and returns its raw result", async () => {
    const response = await request("POST", "/call", {
      token: bridge!.token,
      body: { channel: "test:echo", input: { value: "hello" } },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);
    expect(response.json.result).toEqual({ echo: "hello" });
  });

  it("reports handler failures as a structured error", async () => {
    const response = await request("POST", "/call", {
      token: bridge!.token,
      body: { channel: "test:boom", input: {} },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe(DyadErrorKind.Internal);
    expect(response.json.error.message).toContain("Boom.");
    expect(response.json.error.name).toBe("DyadError");
  });

  it("reports an unknown channel as an error instead of crashing", async () => {
    const response = await request("POST", "/call", {
      token: bridge!.token,
      body: { channel: "test:does-not-exist", input: {} },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe(DyadErrorKind.NotFound);
  });

  it("rejects invalid input for a known channel", async () => {
    const response = await request("POST", "/call", {
      token: bridge!.token,
      body: { channel: "test:echo", input: { value: 42 } },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe(DyadErrorKind.Validation);
  });

  it("rejects a malformed /call body with 400", async () => {
    const response = await request("POST", "/call", {
      token: bridge!.token,
      rawBody: "{not json",
    });
    expect(response.status).toBe(400);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe("validation");
  });

  it("rejects a /call body without a channel with 400", async () => {
    const response = await request("POST", "/call", {
      token: bridge!.token,
      body: { input: {} },
    });
    expect(response.status).toBe(400);
    expect(response.json.error.kind).toBe("validation");
  });

  it("runs a batch of independent calls", async () => {
    const response = await request("POST", "/call-batch", {
      token: bridge!.token,
      body: {
        calls: [
          { channel: "test:echo", input: { value: "one" } },
          { channel: "test:boom", input: {} },
          { channel: "test:echo", input: { value: "two" } },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);
    const results = response.json.results as Array<{
      ok: boolean;
      result?: unknown;
      error?: { kind: string };
    }>;
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ ok: true, result: { echo: "one" } });
    expect(results[1].ok).toBe(false);
    expect(results[1].error?.kind).toBe(DyadErrorKind.Internal);
    expect(results[2]).toEqual({ ok: true, result: { echo: "two" } });
  });

  it("rejects a body over the hard limit with 413", async () => {
    const oversized = "x".repeat(33 * 1024 * 1024);
    const response = await request("POST", "/call", {
      token: bridge!.token,
      rawBody: oversized,
    });
    expect(response.status).toBe(413);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe("validation");
  });

  it("returns 404 for an unknown endpoint", async () => {
    const response = await request("GET", "/nope", { token: bridge!.token });
    expect(response.status).toBe(404);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe("not_found");
  });

  it("returns 405 for a wrong method", async () => {
    const response = await request("GET", "/call", { token: bridge!.token });
    expect(response.status).toBe(405);
    expect(response.json.ok).toBe(false);
    expect(response.json.error.kind).toBe("validation");
  });

  it("writes a discovery file with the port, pid and token", () => {
    const expectedPath = path.join(tempDir, DYAD_CLI_BRIDGE_FILE_NAME);
    expect(bridge!.filePath).toBe(expectedPath);
    expect(dyadCliBridgeFilePath(tempDir)).toBe(expectedPath);

    const raw = fs.readFileSync(expectedPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.port).toBe(bridge!.port);
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.token).toBe(bridge!.token);
    expect(parsed.app).toBe("dyad");
    expect(typeof parsed.startedAt).toBe("string");
    // The file holds the bearer token: it must not be world readable.
    expect(fs.statSync(expectedPath).mode & 0o777).toBe(0o600);
  });

  it("removes the discovery file on close", async () => {
    const expectedPath = path.join(tempDir, DYAD_CLI_BRIDGE_FILE_NAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
    await bridge!.close();
    bridge = null;
    expect(fs.existsSync(expectedPath)).toBe(false);
  });

  it("exposes a stable default port constant", () => {
    expect(DYAD_CLI_BRIDGE_DEFAULT_PORT).toBe(39217);
  });

  it("returns null when the port is already taken", async () => {
    const second = await startDyadCliBridge({
      port: bridge!.port,
      userDataPath: tempDir,
      getSender: () => undefined,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(second).toBeNull();
  });
});
