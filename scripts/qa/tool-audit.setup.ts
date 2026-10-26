import { afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Policy/unit audit only: do not pretend this supplies a desktop runtime.
const fixture = mkdtempSync(join(tmpdir(), "agent2-tool-audit-"));
process.env.DYAD_DEV_USER_DATA_DIR = fixture;
const h = vi.hoisted(() => ({ ipcHandlers: new Map() }));
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
vi.mock("electron-log", async () => {
  const { default: log } = await import("electron-log/node");
  return { default: log };
});
vi.mock("electron-log/main", async () => await import("electron-log/node"));
