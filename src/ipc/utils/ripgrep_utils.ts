/**
 * Shared utilities for ripgrep integration
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const MAX_FILE_SEARCH_SIZE = 1024 * 1024;
export const RIPGREP_EXCLUDED_GLOBS = [
  "!node_modules/**",
  "!.git/**",
  "!.next/**",
];

function getRgExecutableName(): string {
  return os.platform() === "win32" ? "rg.exe" : "rg";
}

/**
 * Get the path to the ripgrep executable.
 * Handles both development and packaged Electron app scenarios.
 */
export function getRgExecutablePath(): string {
  if (!app.isPackaged) {
    // Dev: app.getAppPath() is the project root (same pattern as dugite)
    return path.join(
      app.getAppPath(),
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      getRgExecutableName(),
    );
  }
  // Packaged app: ripgrep is bundled via extraResource
  // Since we extract "node_modules/@vscode/ripgrep", it's at resources/@vscode/ripgrep
  return path.join(
    process.resourcesPath,
    "@vscode",
    "ripgrep",
    "bin",
    getRgExecutableName(),
  );
}

/**
 * True when the ripgrep binary exists on disk.
 *
 * The binary is downloaded by `@vscode/ripgrep`'s postinstall script, so it is
 * absent whenever that script was skipped (npm `allowScripts` gate,
 * `--ignore-scripts`, or an offline install). Callers must check before
 * spawning: `spawn` reports a missing binary as a bare `ENOENT`, which looks
 * like a corrupt install rather than "this build has no search backend".
 */
export function isRgExecutableAvailable(): boolean {
  try {
    return fs.existsSync(getRgExecutablePath());
  } catch {
    return false;
  }
}

/**
 * Throw an actionable error when ripgrep is unavailable.
 *
 * `Precondition` is the right kind: the environment is missing a runtime
 * dependency, not the user's input being wrong, and the failure is not an
 * actionable product bug worth reporting as an exception.
 */
export function assertRgExecutableAvailable(): void {
  if (isRgExecutableAvailable()) {
    return;
  }
  const rgPath = getRgExecutablePath();
  throw new DyadError(
    `The ripgrep (rg) binary is not available at ${rgPath}. ` +
      "Code search is disabled in this installation. Reinstall Dyad so the " +
      "`@vscode/ripgrep` package can download its binary.",
    DyadErrorKind.Precondition,
  );
}
