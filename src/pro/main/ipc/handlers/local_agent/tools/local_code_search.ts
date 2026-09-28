/**
 * Local Code Search - Fuzzy + exact search using Fuse.js and ripgrep
 *
 * Features:
 * - Fuse.js fuzzy search for natural-language queries (typos, partial matches)
 * - ripgrep for fast exact/regex searching
 * - Parallel search across multiple strategies
 * - Result ranking, deduplication, and smart merging
 */

import log from "electron-log";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import Fuse from "fuse.js";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import * as path from "node:path";
import { DEFAULT_EXCLUDE_DIRS } from "./file_utils";

const execFileAsync = promisify(execFile);

const logger = log.scope("local_code_search");

export interface CodeSearchResult {
  file: string;
  line: number;
  content: string;
  matchType: "exact" | "fuzzy" | "regex" | "path";
  score: number;
}

export interface CodeSearchOptions {
  query: string;
  appPath: string;
  filePatterns?: string[];
  excludePatterns?: string[];
  maxResults?: number;
  caseSensitive?: boolean;
  useRegex?: boolean;
}

/** File extensions to index for fuzzy search */
const INDEXABLE_EXTENSIONS = new Set([
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
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".html",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".sql",
  ".sh",
]);

/** Directories to skip during file walking */
const SKIP_DIRS = new Set([
  ...DEFAULT_EXCLUDE_DIRS,
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".expo",
  "__pycache__",
  ".git",
  "node_modules",
]);

/**
 * Main search entry point — tries fuzzy (Fuse.js) first for natural-language
 * queries, falls back to ripgrep for exact/regex, and merges results.
 */
export async function localCodeSearch(
  options: CodeSearchOptions,
): Promise<CodeSearchResult[]> {
  const {
    query,
    appPath,
    maxResults = 50,
    caseSensitive = false,
    useRegex = false,
  } = options;

  const startTime = Date.now();

  // Strategy 1: If user explicitly wants regex, go straight to ripgrep
  if (useRegex) {
    const results = await searchWithRipgrep({
      ...options,
      filePatterns: options.filePatterns ?? ["*"],
      excludePatterns:
        options.excludePatterns ?? Array.from(DEFAULT_EXCLUDE_DIRS),
    });
    const elapsed = Date.now() - startTime;
    logger.log(`Regex search: ${results.length} results in ${elapsed}ms`);
    return results;
  }

  // Strategy 2: Fuse.js fuzzy search — best for natural-language queries
  const fuzzyResults = await searchWithFuse(query, appPath, maxResults);

  // Strategy 3: ripgrep exact search — catches literal matches Fuse might miss
  let exactResults: CodeSearchResult[] = [];
  try {
    exactResults = await searchWithRipgrep({
      ...options,
      filePatterns: options.filePatterns ?? ["*"],
      excludePatterns:
        options.excludePatterns ?? Array.from(DEFAULT_EXCLUDE_DIRS),
      caseSensitive,
      useRegex: false,
    });
  } catch {
    // ripgrep not available — fuzzy results are sufficient
  }

  // Merge: exact matches boost fuzzy results, deduplicate by file:line
  const merged = mergeResults(fuzzyResults, exactResults, maxResults);

  const elapsed = Date.now() - startTime;
  logger.log(
    `Code search: ${merged.length} results (fuzzy: ${fuzzyResults.length}, exact: ${exactResults.length}) in ${elapsed}ms`,
  );

  return merged;
}

// ─── Fuse.js Fuzzy Search ────────────────────────────────────────────────────

interface FuseIndexEntry {
  filePath: string;
  line: number;
  content: string;
  pathParts: string; // normalized path for path matching
}

/**
 * Walk the codebase and build a Fuse.js index of file paths + line contents.
 * This is the core improvement — enables fuzzy matching on natural language.
 */
async function buildSearchIndex(
  appPath: string,
  maxFiles: number = 2000,
): Promise<FuseIndexEntry[]> {
  const entries: FuseIndexEntry[] = [];
  let fileCount = 0;

  const walk = async (dir: string): Promise<void> => {
    if (fileCount >= maxFiles) return;

    let dirEntries;
    try {
      dirEntries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (fileCount >= maxFiles) break;
      // Skip all dotfiles including .env (contains secrets)
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!INDEXABLE_EXTENSIONS.has(ext)) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > 200_000) continue; // skip huge files

        const content = await fs.readFile(fullPath, "utf-8");
        if (content.includes("\u0000")) continue; // skip binary

        const relPath = path.relative(appPath, fullPath);
        const lines = content.split("\n");

        // Index the file path itself (enables "find auth middleware" → matches path)
        entries.push({
          filePath: relPath,
          line: 0,
          content: relPath,
          pathParts: relPath.toLowerCase().replace(/[/\\]/g, " "),
        });

        // Index each non-empty line (up to 500 lines per file to keep index manageable)
        const linesToIndex = Math.min(lines.length, 500);
        for (let i = 0; i < linesToIndex; i++) {
          const line = lines[i].trim();
          if (line.length < 3 || line.length > 500) continue;
          // Skip pure comments and blank lines
          if (/^\s*(\/\/|#|\/\*|\*\/|\*|<!--)/.test(line)) continue;

          entries.push({
            filePath: relPath,
            line: i + 1,
            content: line,
            pathParts: relPath.toLowerCase(),
          });
        }

        fileCount++;
      } catch {
        // skip unreadable
      }
    }
  };

  await walk(appPath);
  return entries;
}

/**
 * Fuse.js fuzzy search — the magic that makes "authentication logic" work
 * even when no file contains that exact phrase.
 */
async function searchWithFuse(
  query: string,
  appPath: string,
  maxResults: number,
): Promise<CodeSearchResult[]> {
  try {
    const indexEntries = await buildSearchIndex(appPath);
    if (indexEntries.length === 0) return [];

    const fuse = new Fuse(indexEntries, {
      keys: [
        { name: "content", weight: 0.6 },
        { name: "pathParts", weight: 0.3 },
        { name: "filePath", weight: 0.1 },
      ],
      threshold: 0.4, // 0.0 = exact, 1.0 = match everything. 0.4 = good balance
      distance: 200, // how far a match can be from expected position
      includeScore: true,
      minMatchCharLength: 2,
      ignoreLocation: true, // match anywhere in the string
    });

    const fuseResults = fuse.search(query, { limit: maxResults * 2 });

    return fuseResults
      .filter((r) => r.score !== undefined && r.score < 0.6)
      .slice(0, maxResults)
      .map((r) => ({
        file: r.item.filePath,
        line: r.item.line,
        content: r.item.content.substring(0, 200),
        matchType: r.item.line === 0 ? ("path" as const) : ("fuzzy" as const),
        score: 1 - (r.score ?? 0), // invert: Fuse returns 0=best, we want 1=best
      }));
  } catch (error: unknown) {
    logger.warn("Fuse.js search failed:", error);
    return [];
  }
}

// ─── Ripgrep Exact Search ────────────────────────────────────────────────────

async function searchWithRipgrep(
  options: CodeSearchOptions & {
    filePatterns: string[];
    excludePatterns: string[];
  },
): Promise<CodeSearchResult[]> {
  const {
    query,
    appPath,
    filePatterns,
    excludePatterns,
    maxResults = 50,
    caseSensitive,
  } = options;

  const args = [
    "--json",
    "--no-heading",
    "--line-number",
    "--max-count",
    String(maxResults),
  ];

  if (!caseSensitive) args.push("--ignore-case");
  args.push("--fixed-strings", query);

  for (const pattern of filePatterns) args.push("--glob", pattern);
  for (const pattern of excludePatterns) args.push("--glob", `!${pattern}`);
  args.push(appPath);

  let result;
  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: appPath,
      timeout: 10_000,
    });
    result = { stdout, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; code?: number };
    result = {
      stdout: err.stdout ?? "",
      exitCode: err.code ?? 1,
    };
  }

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new DyadError(
      `ripgrep failed with exit code ${result.exitCode}`,
      DyadErrorKind.Validation,
    );
  }

  const results: CodeSearchResult[] = [];
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    try {
      const json = JSON.parse(line);
      if (json.type === "match") {
        results.push({
          file: json.path.text,
          line: json.line_number,
          content: json.submatches?.[0]?.match?.text || json.lines.text,
          matchType: "exact",
          score: 0.9, // exact matches are always high quality
        });
      }
    } catch {
      // skip malformed JSON
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// ─── Result Merging ──────────────────────────────────────────────────────────

/**
 * Merge fuzzy and exact results: exact matches boost fuzzy scores,
 * deduplicate by file:line, and return top N.
 */
function mergeResults(
  fuzzy: CodeSearchResult[],
  exact: CodeSearchResult[],
  maxResults: number,
): CodeSearchResult[] {
  const seen = new Map<string, CodeSearchResult>();

  // Add exact results first (highest priority)
  for (const r of exact) {
    const key = `${r.file}:${r.line}`;
    seen.set(key, { ...r, score: Math.max(r.score, 0.9) });
  }

  // Add fuzzy results, boosting score if already seen as exact
  for (const r of fuzzy) {
    const key = `${r.file}:${r.line}`;
    const existing = seen.get(key);
    if (existing) {
      // Already found by exact search — boost score
      existing.score = Math.min(1.0, existing.score + 0.1);
    } else {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatCodeSearchResults(results: CodeSearchResult[]): string {
  if (results.length === 0) {
    return "No code matches found.";
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.file}:${r.line}** [${r.matchType}]\n   ${r.content.substring(0, 120)}`,
    )
    .join("\n\n");
}
