import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "darwin") {
  console.log(
    `Skipping dyad-keychain-reader rebuild on ${process.platform}; it is macOS-only.`,
  );
  process.exit(0);
}

// Rebuild directly with node-gyp to bypass npm's EALLOWSCRIPTS on Node 26.
const pkgDir = resolve(process.cwd(), "node_modules/dyad-keychain-reader");
try {
  execFileSync("npx", ["node-gyp", "rebuild"], {
    cwd: pkgDir,
    stdio: "inherit",
  });
  console.log("dyad-keychain-reader rebuilt successfully.");
} catch (error) {
  console.error("Rebuild failed:", error?.message ?? error);
  process.exit(1);
}
