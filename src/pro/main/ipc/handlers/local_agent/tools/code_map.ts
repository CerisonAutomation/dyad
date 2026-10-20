import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./types";

const MAX_FILES = 400;
const MAX_LISTED = 120;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".output",
  "coverage",
  ".cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "target",
  "vendor",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
  ".css",
  ".html",
  ".json",
  ".md",
]);

const codeMapSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Subdirectory to map, relative to the app root. Defaults to the whole app.",
    ),
  includeExports: z
    .boolean()
    .optional()
    .describe(
      "Include each file's exports. Defaults to true. Turn off for a large codebase.",
    ),
});

const DESCRIPTION = `Get a compact structural map of the codebase: file tree, detected framework, and each file's exports.

Use this FIRST when you are new to an unfamiliar codebase or after many files have changed — it costs far fewer tokens than reading files and gives you the shape of the project: where things live, what each module exposes, and which framework conventions apply.

Then use \`ast_grep_search\` to find code by structure, and \`read_file\` for the specific files that matter.
`;

export const codeMapTool: ToolDefinition = {
  name: "code_map",
  description: DESCRIPTION,
  inputSchema: codeMapSchema,
  defaultConsent: "always",
  modifiesState: false,
  getConsentPreview: (args) =>
    `Map the structure of ${args.path ?? "the whole app"}`,
  execute: async (args, ctx) => {
    const root = args.path ? path.join(ctx.appPath, args.path) : ctx.appPath;
    const files = await collectFiles(root);
    if (files.length === 0) {
      return `No source files found under ${args.path ?? ctx.appPath}.`;
    }

    const sections: string[] = [];
    sections.push(await describeStack(ctx.appPath));
    sections.push(describeTree(root, files, args.path));

    if (args.includeExports !== false) {
      const exportsSection = await describeExports(root, files);
      if (exportsSection) sections.push(exportsSection);
    }

    return sections.join("\n\n");
  },
};

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    if (out.length >= MAX_FILES * 3) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES * 3) return;
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out.sort();
}

async function describeStack(appPath: string): Promise<string> {
  const lines: string[] = [];
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(appPath, "package.json"), "utf8"),
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    lines.push(`Package: ${pkg.name ?? "?"} v${pkg.version ?? "?"}`);
    const frameworks = [
      "next",
      "react",
      "vue",
      "svelte",
      "vite",
      "astro",
      "remix",
      "express",
      "hono",
      "fastify",
      "prisma",
      "drizzle-orm",
      "@supabase/supabase-js",
      "tailwindcss",
      "electron",
    ].filter((dep) => deps[dep]);
    if (frameworks.length) {
      lines.push(
        `Key dependencies: ${frameworks.map((d) => `${d}@${deps[d]}`).join(", ")}`,
      );
    }
    const scripts = Object.keys(pkg.scripts ?? {}).slice(0, 12);
    if (scripts.length) lines.push(`Scripts: ${scripts.join(", ")}`);
  } catch {
    lines.push("No package.json found at the app root.");
  }
  for (const cfg of [
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "astro.config.mjs",
  ]) {
    try {
      await fs.access(path.join(appPath, cfg));
      lines.push(`Config: ${cfg}`);
    } catch {
      /* not present */
    }
  }
  return `## Stack\n${lines.join("\n")}`;
}

function describeTree(
  root: string,
  files: string[],
  displayRoot?: string,
): string {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const rel = path.relative(root, file);
    const dir = path.dirname(rel) === "." ? "./" : path.dirname(rel);
    const bucket = byDir.get(dir) ?? [];
    bucket.push(path.basename(rel));
    byDir.set(dir, bucket);
  }
  const dirs = [...byDir.keys()].sort();
  const lines: string[] = [];
  for (const dir of dirs) {
    if (lines.length >= MAX_LISTED) {
      lines.push(`… ${dirs.length - lines.length} more directories`);
      break;
    }
    const names = byDir.get(dir)!.sort();
    const shown = names.slice(0, 25);
    const suffix =
      names.length > shown.length
        ? ` (+${names.length - shown.length} more)`
        : "";
    lines.push(
      `${displayRoot ? path.join(displayRoot, dir) : dir}/  ${shown.join(", ")}${suffix}`,
    );
  }
  return `## Structure (${files.length} source files)\n${lines.join("\n")}`;
}

async function describeExports(
  root: string,
  files: string[],
): Promise<string | null> {
  // A map is a digest, not an analysis. This is a cheap lexical scan over the
  // file head; spawning a parser per file would take minutes on a real
  // codebase. Use ast_grep_search when structural matching is actually needed.
  const chunks: string[] = [];
  let scanned = 0;
  for (const file of files) {
    if (chunks.length >= MAX_FILES) break;
    const ext = path.extname(file);
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) continue;
    let head: string;
    try {
      const stat = await fs.stat(file);
      if (stat.size === 0 || stat.size > 400_000) continue;
      head = (await fs.readFile(file, "utf8")).slice(0, 200_000);
    } catch {
      continue;
    }
    const names = extractExports(head);
    if (names.length) {
      chunks.push(
        `${path.relative(root, file)}: ${names.slice(0, 12).join(", ")}` +
          (names.length > 12 ? ` (+${names.length - 12})` : ""),
      );
      scanned++;
    }
  }
  if (chunks.length === 0) return null;
  return `## Exports (${scanned} files)\n${chunks.join("\n")}`;
}

/**
 * Cheap lexical export extraction. Deliberately conservative: it only reads
 * top-level `export` lines, and drops matches whose name looks like a
 * destructuring pattern rather than an identifier.
 */
function extractExports(source: string): string[] {
  const names: string[] = [];
  const patterns: RegExp[] = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    /^export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/,
    /^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  ];
  for (const line of source.split("\n")) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        names.push(match[1]);
        break;
      }
    }
    if (names.length > 40) break;
  }
  return names;
}
