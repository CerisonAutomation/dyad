#!/usr/bin/env node
// Patches @electron/packager's Electron-zip extractor.
//
// Why: extract-zip@2.0.1 (yauzl) hangs on Node 26 while extracting the
// Electron zip -- the read stream for an entry never settles, so the promise
// never resolves, the Node event loop drains and the process exits 0 WITHOUT
// producing an `out/` bundle. electron-forge's packaging therefore appears to
// succeed while silently shipping nothing.
//
// The patch swaps the JS extractor for the platform-native one (macOS `ditto`,
// otherwise `unzip`), which preserves symlinks and permissions and is faster.
//
// The patch is idempotent and never fails the install: if anything goes wrong
// the original file is left untouched.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "DYAD_PATCHED_EXTRACT";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const target = path.join(
  repoRoot,
  "node_modules",
  "@electron",
  "packager",
  "dist",
  "unzip.js",
);

const patched = `"use strict";
// ${MARKER}
// extract-zip@2.0.1 (yauzl) hangs on Node 26 while extracting the Electron
// zip: the read stream for an entry never settles, so the promise never
// resolves, the Node event loop drains and the process exits 0 without
// producing a bundle. Use the platform-native unzip instead -- it is faster
// and preserves symlinks and permissions.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractElectronZip = void 0;
const child_process_1 = require("child_process");
const fs = require("fs");
function run(command, args) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(command, args, { maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(command + " failed (" + error.message + "): " + (stderr || stdout)));
                return;
            }
            resolve();
        });
    });
}
async function extractElectronZip(zipPath, targetDir) {
    await fs.promises.mkdir(targetDir, { recursive: true });
    if (process.platform === "darwin") {
        await run("/usr/bin/ditto", ["-x", "-k", zipPath, targetDir]);
        return;
    }
    await run("unzip", ["-q", "-o", zipPath, "-d", targetDir]);
}
exports.extractElectronZip = extractElectronZip;
//# sourceMappingURL=unzip.js.map
`;

function main() {
  if (!fs.existsSync(target)) {
    console.log(
      "[patch-electron-packager] @electron/packager not installed yet; skipping.",
    );
    return;
  }
  const current = fs.readFileSync(target, "utf8");
  if (current.includes(MARKER)) {
    console.log("[patch-electron-packager] already patched.");
    return;
  }
  fs.writeFileSync(target, patched, "utf8");
  console.log(
    "[patch-electron-packager] patched @electron/packager Electron-zip extractor.",
  );
}

try {
  main();
} catch (error) {
  console.warn(
    `[patch-electron-packager] could not patch @electron/packager: ${error?.message ?? error}`,
  );
}
