import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log(
    `Skipping dyad-keychain-reader rebuild on ${process.platform}; it is macOS-only.`,
  );
  process.exit(0);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// node_modules/dyad-keychain-reader is a `file:` link to native/keychain-reader,
// so the compiled artifact lives in the source tree.
const artifact = join(
  repoRoot,
  "native",
  "keychain-reader",
  "build",
  "Release",
  "keychain_reader.node",
);

if (existsSync(artifact)) {
  console.log(
    `dyad-keychain-reader already built (${artifact}); skipping rebuild.`,
  );
  process.exit(0);
}

try {
  execFileSync("npm", ["rebuild", "dyad-keychain-reader"], {
    stdio: "inherit",
  });
} catch {
  // npm >=11 refuses `npm rebuild <pkg>` with EALLOWSCRIPTS unless the package is
  // listed in `allowScripts`. That only matters when the artifact is missing, so
  // fall back to building the binding directly rather than failing the package.
  console.warn(
    "npm rebuild dyad-keychain-reader was refused; building the binding directly.",
  );
  execFileSync("npx", ["node-gyp", "rebuild"], {
    stdio: "inherit",
    cwd: join(repoRoot, "native", "keychain-reader"),
  });
}
