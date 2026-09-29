import * as fs from "node:fs";
import * as path from "node:path";

import { NEXTJS_CONFIG_FILES } from "@/lib/framework_constants";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * Wires @dyad-sh/nextjs-webpack-component-tagger into a Next.js app.
 *
 * The component selector reads data-dyad-id to both identify an element and to
 * find the file that owns it. Those attributes are written at build time, and
 * until now only the Vite tagger was ever installed - a Vite *plugin*, wired
 * into vite.config. A Next.js app is built by webpack, so the equivalent is a
 * *loader* wired into next.config, and that package already exists in this
 * repo but was never referenced by anything.
 *
 * Without this, a Next.js app can select elements (via the runtime ids the
 * selector falls back to) but never resolves to a source file.
 */

export const TAGGER_PACKAGE = "@dyad-sh/nextjs-webpack-component-tagger";
export const TAGGER_VERSION = "^0.8.0";
const MARKER = TAGGER_PACKAGE;

export function findNextConfigPath(appPath: string): string | null {
  for (const file of NEXTJS_CONFIG_FILES) {
    const candidate = path.join(appPath, file);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function isNextComponentTaggerUpgradeNeeded(appPath: string): boolean {
  const configPath = findNextConfigPath(appPath);
  if (!configPath) return false;
  try {
    // Not gated on an existing `webpack` callback: most hand-written next.config
    // files do not have one, and addTaggerRule creates it when missing. Gating on
    // it here meant the upgrade was never offered for exactly the apps that
    // needed it.
    const content = fs.readFileSync(configPath, "utf-8");
    return !content.includes(MARKER);
  } catch (error) {
    return false;
  }
}

const RULE = `    config.module.rules.push({
      test: /\\.[jt]sx?$/,
      exclude: /node_modules/,
      use: {
        loader: "${TAGGER_PACKAGE}",
        options: { collectDependencies: false },
      },
    });`;

/**
 * Injects the loader rule into an existing `webpack(config) { ... }` callback.
 *
 * next.config files are plain JavaScript, so this is a targeted string edit
 * rather than an AST transform: it finds the callback body, and appends the
 * rule just before the closing `return config`. Idempotent - re-running leaves
 * an already-tagged config untouched.
 */
export function addTaggerRule(content: string): string {
  if (content.includes(MARKER)) return content;

  const bodyStart = findWebpackBodyStart(content);
  if (bodyStart === -1) {
    return addWebpackCallback(content);
  }

  const closing = content.lastIndexOf("return");
  if (closing === -1 || closing < bodyStart) {
    throw new DyadError(
      "Could not find `return config` in the webpack callback in next.config.",
      DyadErrorKind.Validation,
    );
  }

  return (
    content.slice(0, closing) + RULE + "\n    " + content.slice(closing)
  );
}

const CALLBACK = `  webpack(config) {
${RULE}
    return config;
  },`;

/**
 * Adds a `webpack` callback to a config that does not have one yet - the common
 * case for a hand-written next.config, which usually only sets headers and
 * output options.
 *
 * Only the single top-level `NextConfig` object literal is touched. Anything
 * harder to identify unambiguously is refused rather than guessed at, because a
 * wrong insertion here breaks the user's build with no obvious cause.
 */
function addWebpackCallback(content: string): string {
  const decl = /=\s*\{\s*\n/.exec(content);
  if (!decl) {
    throw new DyadError(
      "Could not find the NextConfig object in next.config. Add this by hand:\n" +
        `  webpack(config) {\n${RULE}\n    return config;\n  },`,
      DyadErrorKind.Validation,
    );
  }

  // Walk braces from the object literal's opening to find its match.
  const open = content.indexOf("{", decl.index);
  let depth = 0;
  let end = -1;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new DyadError(
      "next.config object literal is unbalanced; refusing to edit it.",
      DyadErrorKind.Validation,
    );
  }

  return (
    content.slice(0, end).replace(/\s*$/, "") +
    "\n" +
    CALLBACK +
    "\n" +
    content.slice(end)
  );
}

function findWebpackBodyStart(content: string): number {
  // next.config uses three shapes: `webpack: (config) => {`,
  // `webpack: function (config) {` and the shorthand method `webpack(config) {`.
  // Match the `webpack` key, then skip the parameter list to the body brace.
  const key = /webpack\s*:?\s*(?=\(|function\b)/.exec(content);
  if (!key) return -1;
  const from = key.index;
  const open = content.indexOf("{", from);
  return open === -1 ? -1 : open + 1;
}

export async function applyNextComponentTaggerUpgrade(
  appPath: string,
): Promise<{ configPath: string }> {
  const configPath = findNextConfigPath(appPath);
  if (!configPath) {
    throw new DyadError(
      `Could not find any of: ${NEXTJS_CONFIG_FILES.join(", ")}`,
      DyadErrorKind.NotFound,
    );
  }

  const original = await fs.promises.readFile(configPath, "utf-8");
  const patched = addTaggerRule(original);
  if (patched === original) {
    return { configPath };
  }

  const backup = `${configPath}.dyad-backup`;
  await fs.promises.writeFile(backup, original, "utf-8");
  await fs.promises.writeFile(configPath, patched, "utf-8");
  return { configPath };
}
