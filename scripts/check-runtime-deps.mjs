#!/usr/bin/env node
/**
 * Guards a failure class that unit tests cannot see.
 *
 * Every one of these shipped broken and every one of them had passing tests:
 *
 *   - the preview browser did `await import("playwright")`, but playwright was
 *     never a declared dependency. It resolved in development through hoisting
 *     from a devDependency and was pruned from every packaged build, so the
 *     feature could never work in the app.
 *   - the bundled playwright then required a deep relative path that escaped
 *     the asar, breaking the same feature at module load.
 *   - the reasoning fold took a fetch from a test-only override, so it returned
 *     undefined in production and the whole fix was dead code.
 *
 * All of them are the same shape: a module reference that is fine on a developer
 * machine and absent or wrong once packaged. This runs against the real
 * dependency list and fails the build rather than letting it ship.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
]);

const raw = execSync(
  `grep -rhoE 'await import\\("[^"]+"\\)' src/ worker/ scripts/ --include=*.ts --include=*.tsx --include=*.mjs 2>/dev/null || true`,
  { encoding: "utf8" },
);

const bare = new Set();
for (const line of raw.split("\n")) {
  const match = /await import\("([^"]+)"\)/.exec(line);
  if (!match) continue;
  const spec = match[1];
  // Internal: relative paths and the "@/" alias are resolved by the bundler.
  if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("node:")) {
    continue;
  }
  // Electron and Node built-ins are provided by the runtime.
  if (spec === "electron" || spec.startsWith("electron/")) continue;
  bare.add(spec);
}

const missing = [];
for (const spec of bare) {
  const top = spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : spec.split("/")[0];
  if (!declared.has(top)) missing.push({ spec, top });
}

console.log(
  `check-runtime-deps: ${bare.size} bare dynamic import target(s) checked`,
);
if (missing.length === 0) {
  console.log("check-runtime-deps: all declared in package.json");
  process.exit(0);
}

console.error("\ncheck-runtime-deps: FAILED\n");
for (const { spec, top } of missing) {
  console.error(`  ${spec}`);
  console.error(`    -> "${top}" is imported at runtime but is not in dependencies or devDependencies.`);
  console.error(`       It will resolve locally through hoisting and be missing from the packaged app.\n`);
}
process.exit(1);
