import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const appState = { isPackaged: false, appPath: "" };

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getAppPath() {
      return appState.appPath;
    },
  },
}));

import {
  assertRgExecutableAvailable,
  getRgExecutablePath,
  isRgExecutableAvailable,
} from "./ripgrep_utils";

describe("ripgrep executable resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-ripgrep-utils-"));
    appState.isPackaged = false;
    appState.appPath = tempDir;
    vi.stubEnv("DYAD_TEST", "1");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeRipgrepBinary(appPath: string): string {
    const binDir = path.join(appPath, "node_modules/@vscode/ripgrep/bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binaryPath = path.join(
      binDir,
      os.platform() === "win32" ? "rg.exe" : "rg",
    );
    fs.writeFileSync(binaryPath, "binary");
    return binaryPath;
  }

  it("reports the binary as unavailable when the postinstall never ran", () => {
    // The package directory exists but bin/rg does not: this is exactly what
    // a skipped `@vscode/ripgrep` postinstall leaves behind.
    fs.mkdirSync(path.join(tempDir, "node_modules/@vscode/ripgrep/lib"), {
      recursive: true,
    });

    expect(isRgExecutableAvailable()).toBe(false);
  });

  it("throws an actionable Precondition error when the binary is missing", () => {
    expect(() => assertRgExecutableAvailable()).toThrow(DyadError);

    try {
      assertRgExecutableAvailable();
      expect.unreachable("expected the guard to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DyadError);
      expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
      expect((error as DyadError).message).toMatch(/ripgrep \(rg\) binary/);
      expect((error as DyadError).message).toMatch(/Reinstall Dyad/);
    }
  });

  it("passes the guard when the binary exists", () => {
    writeRipgrepBinary(tempDir);

    expect(isRgExecutableAvailable()).toBe(true);
    expect(() => assertRgExecutableAvailable()).not.toThrow();
  });

  it("resolves the dev path under node_modules", () => {
    writeRipgrepBinary(tempDir);

    expect(getRgExecutablePath()).toContain(
      path.join("node_modules", "@vscode", "ripgrep", "bin"),
    );
  });
});
