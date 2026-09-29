#!/usr/bin/env node
/**
 * Verifies the packaging invariant that the Playwright bug violated.
 *
 * Vite bundles almost every dependency into .vite/build, which is why
 * forge.config's ignore() can drop ~89 of the 98 runtime dependencies and the
 * app still runs. The drop only matters for modules Vite is told NOT to
 * bundle: those are loaded from node_modules at runtime, so if ignore() filters
 * them out the feature works on a developer machine and is missing from every
 * packaged build.
 *
 * playwright was exactly that. It was declared external, resolved locally
 * through hoisting, and was not in the allowlist - so the preview browser could
 * never work in the shipped app, with a green build and a passing test suite.
 *
 * The invariant, stated once:
 *   every external  =>  declared in package.json  AND  kept by ignore()
 */
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
]);
const forge = readFileSync("forge.config.ts", "utf8");

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

// Parse `external: [ ... ]` out of every vite config.
const externals = new Set();
const vestigial = new Set();
let concatSrc = "";
for (const file of readdirSync(".").filter((f) => /^vite\..*\.config\.mts$/.test(f))) {
  // Comments mention require paths and error strings; parsing them as
  // externals produced entries like "Cannot find module '../../../package.json'".
  const src = readFileSync(file, "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /external:\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) continue;
  for (const m of block[1].matchAll(/"([^"]+)"/g)) externals.add(m[1]);
  concatSrc += src;
}

// Concatenated source, comments stripped, for checking that an external is
// actually referenced somewhere before calling it a packaging risk.
concatSrc += execSync(
  // Tests are excluded: they never run in the packaged app, so an import that
  // only appears there is not a packaging risk.
  `cat $(find src worker -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \\) ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.spec.ts' ! -name '*.integration.test.ts' 2>/dev/null | head -4000) 2>/dev/null || true`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

// The packager keeps a path when ignore() returns false for it. Collect every
// prefix it explicitly keeps, plus the loop I added over a package list.
const kept = new Set();
for (const m of forge.matchAll(/\/node_modules\/([A-Za-z0-9@._-]+)/g)) {
  kept.add(m[1]);
}
for (const m of forge.matchAll(/`\/node_modules\/\$\{pkg\}`/g)) kept.add("@loop");
if (kept.has("@loop")) {
  for (const p of ["playwright", "playwright-core", "chromium-bidi", "fsevents"]) {
    kept.add(p);
  }
}
const isRuntimeDependency = (name) => new RegExp(`"${name}"`).test(forge);

const problems = [];
for (const ext of externals) {
  if (builtins.has(ext) || ext.startsWith("node:")) continue;
  if (!ext || ext.includes("*") || ext.includes("/.") || ext.includes(" ")) continue;
  // An external nobody imports is vestigial config, not a packaging risk.
  const referenced = new RegExp(
    `(from|require\\(|import\\()\\s*["']${ext.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}`,
  ).test(concatSrc);
  if (!referenced) { vestigial.add(ext); continue; }
  // A bare specifier: scoped or plain, no relative segments, no paths.
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*|[a-z0-9-~][a-z0-9-._~]*)$/i.test(ext)) {
    continue;
  }

  const top = ext.startsWith("@") ? ext.split("/").slice(0, 2).join("/") : ext;
  if (!declared.has(top)) {
    problems.push({
      ext,
      kind: "not declared",
      fix: `add "${top}" to dependencies - it is external, so it is loaded from node_modules at runtime`,
    });
    continue;
  }
  const keptByPrefix = [...kept].some(
    (k) => top === k || top.startsWith(`${k}/`),
  );
  if (!keptByPrefix && !isRuntimeDependency(top)) {
    problems.push({
      ext,
      kind: "filtered out of the app",
      fix: `add a "/node_modules/${top}" allowlist entry to ignore() in forge.config.ts`,
    });
  }
}

if (vestigial.size > 0) {
  console.log(
    `check-externals: ignoring ${vestigial.size} vestigial external(s) not referenced in src: ${[...vestigial].join(", ")}`,
  );
}
console.log(
  `check-externals: ${externals.size} referenced external(s) across ${readdirSync(".").filter((f) => /^vite\..*\.config\.mts$/.test(f)).length} vite configs`,
);
if (problems.length === 0) {
  console.log("check-externals: every external is declared and packaged");
  process.exit(0);
}
console.error("\ncheck-externals: FAILED\n");
for (const p of problems) {
  console.error(`  ${p.ext}`);
  console.error(`    ${p.kind}: ${p.fix}\n`);
}
process.exit(1);
