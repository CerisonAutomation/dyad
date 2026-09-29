import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];

// Node 26 is outside the supported range, and it fails silently: electron/packager
// starts extracting the Electron zip, the process exits 0 before copying, and
// `out/` is never created - with no error anywhere. A build that reports success
// and produces nothing is far worse than one that refuses to start, so check the
// range here rather than discovering it after a five-minute wait.
const { engines } = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const range = engines?.node;
if (range) {
  const min = />=\s*(\d+)/.exec(range)?.[1];
  const max = /<\s*(\d+)/.exec(range)?.[1];
  const major = Number(process.versions.node.split(".")[0]);
  if (
    (min && major < Number(min)) ||
    (max && major >= Number(max))
  ) {
    problems.push(
      `Node ${process.versions.node} is outside the supported range "${range}". ` +
        `electron/packager misbehaves silently on unsupported Node versions, ` +
        `producing a successful-looking build with no output.`,
    );
  }
}

// A dangling symlink in the project root makes packager's directory scan throw
// ENOENT while it copies the app, which is unrelated to anything it was asked to
// package. Find them before the build rather than five minutes in.
for (const entry of ["CLAUDE.md", "AGENTS.md"]) {
  const path = join(repoRoot, entry);
  if (!existsSync(path) && lstatExists(path)) {
    problems.push(
      `\`${entry}\` is a dangling symlink (-> ${readlinkSync(path)}) and has no target. ` +
        `electron/packager fails with ENOENT on it.`,
    );
  }
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

if (problems.length > 0) {
  console.error("Refusing to build — the environment is broken:\n");
  for (const problem of problems) {
    console.error(`  - ${problem}\n`);
  }
  process.exit(1);
}
