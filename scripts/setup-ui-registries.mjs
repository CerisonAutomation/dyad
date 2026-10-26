import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const presets = JSON.parse(
  fs.readFileSync(
    new URL("../shared/ui-registry-presets.json", import.meta.url),
    "utf8",
  ),
);
export function mergeUiRegistries(config) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("components.json must contain an object");
  if (
    config.registries !== undefined &&
    (!config.registries ||
      typeof config.registries !== "object" ||
      Array.isArray(config.registries))
  )
    throw new Error("registries must contain an object");
  const registries = { ...config.registries };
  const preserved = [];
  for (const entry of presets.registries) {
    if (entry.builtin) {
      if (Object.hasOwn(registries, entry.name))
        throw new Error(
          `${entry.name} is built in and cannot be overridden; remove its explicit registry entry first`,
        );
      continue;
    }
    const url =
      entry.legacyRadixUrl && ["new-york", "default"].includes(config.style)
        ? entry.legacyRadixUrl
        : entry.url;
    for (const name of [entry.name, ...entry.aliases]) {
      if (Object.hasOwn(registries, name) && registries[name] !== url) {
        preserved.push(name);
        continue;
      }
      registries[name] = url;
    }
  }
  return { config: { ...config, registries }, preserved };
}
export function setupUiRegistries(cwd, { check = false } = {}) {
  const root = fs.realpathSync(cwd);
  const file = path.join(root, "components.json");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error(
      "Use a regular components.json file smaller than 1 MiB; initialize shadcn in the target project first",
    );
  const previous = fs.readFileSync(file, "utf8");
  const merged = mergeUiRegistries(JSON.parse(previous));
  const next = JSON.stringify(merged.config, null, 2) + "\n";
  const changed = next !== previous;
  if (changed && !check) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, next, {
        flag: "wx",
        mode: stat.mode & 0o777,
      });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return {
    changed,
    preserved: merged.preserved,
    registries: merged.config.registries,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const cwdIndex = args.indexOf("--cwd");
    if (
      args.some(
        (arg, index) =>
          !["--cwd", "--check"].includes(arg) &&
          !(cwdIndex >= 0 && index === cwdIndex + 1),
      )
    )
      throw new Error(
        "Usage: node scripts/setup-ui-registries.mjs [--cwd <project>] [--check]",
      );
    if (
      cwdIndex >= 0 &&
      (!args[cwdIndex + 1] || args[cwdIndex + 1].startsWith("--"))
    )
      throw new Error("--cwd needs a project directory");
    const result = setupUiRegistries(
      cwdIndex < 0 ? process.cwd() : args[cwdIndex + 1],
      { check: args.includes("--check") },
    );
    console.log(
      JSON.stringify(
        {
          changed: result.changed,
          preserved: result.preserved,
          registries: Object.keys(result.registries),
        },
        null,
        2,
      ),
    );
    if (result.preserved.length || (args.includes("--check") && result.changed))
      process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof SyntaxError
        ? "components.json is not valid JSON; inspect it locally"
        : error.message,
    );
    process.exitCode = 1;
  }
}
