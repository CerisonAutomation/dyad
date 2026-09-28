import * as fs from "node:fs/promises";
import * as path from "node:path";
import log from "electron-log";

const logger = log.scope("file_utils");

/**
 * Shared exclude directories for all file tree walks.
 * Superset of all 13 previously duplicated EXCLUDE_DIRS sets.
 */
export const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
  ".cache",
  ".parcel-cache",
  "vendor",
  ".venv",
  "venv",
  ".dyad",
]);

export interface WalkDirectoryOptions {
  /** Directories to exclude (defaults to DEFAULT_EXCLUDE_DIRS) */
  exclude?: Set<string>;
  /** Max files to collect (default: 500) */
  maxFiles?: number;
  /** Max directory depth (default: 10) */
  maxDepth?: number;
  /** File extension filter, e.g. /\.(ts|tsx|js|jsx)$/ */
  filePattern?: RegExp;
  /**
   * Skip files larger than this in bytes. Only set when size filtering is
   * explicitly needed — the stat() call adds overhead per file.
   * Undefined means no size check (default: undefined).
   */
  maxFileSize?: number;
}

/**
 * Recursively walk a directory tree and collect file paths.
 * Shared across all analysis tools to eliminate duplication.
 */
export async function walkDirectory(
  dir: string,
  options: WalkDirectoryOptions = {},
): Promise<string[]> {
  const {
    exclude = DEFAULT_EXCLUDE_DIRS,
    maxFiles = 500,
    maxDepth = 10,
    filePattern,
    maxFileSize,
  } = options;

  const files: string[] = [];
  await _walk(
    dir,
    exclude,
    maxFiles,
    maxDepth,
    0,
    filePattern,
    maxFileSize,
    files,
  );
  return files;
}

async function _walk(
  dir: string,
  exclude: Set<string>,
  maxFiles: number,
  maxDepth: number,
  currentDepth: number,
  filePattern: RegExp | undefined,
  maxFileSize: number | undefined,
  files: string[],
): Promise<void> {
  if (files.length >= maxFiles || currentDepth >= maxDepth) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (exclude.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await _walk(
          fullPath,
          exclude,
          maxFiles,
          maxDepth,
          currentDepth + 1,
          filePattern,
          maxFileSize,
          files,
        );
      } else if (entry.isFile()) {
        // File pattern filter
        if (filePattern && !filePattern.test(entry.name)) continue;

        // File size guard (only when explicitly requested)
        if (maxFileSize !== undefined) {
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > maxFileSize) continue;
          } catch {
            continue; // Skip inaccessible files
          }
        }

        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

/**
 * Check if a file should be analyzed (size + pattern).
 * Use before reading large files in analysis tools.
 */
export async function shouldAnalyzeFile(
  filePath: string,
  options: { maxFileSize?: number; filePattern?: RegExp } = {},
): Promise<boolean> {
  const { maxFileSize, filePattern } = options;

  if (filePattern && !filePattern.test(path.basename(filePath))) return false;

  if (maxFileSize !== undefined) {
    try {
      const stat = await fs.stat(filePath);
      const limit = maxFileSize;
      return stat.size <= limit;
    } catch {
      return false;
    }
  }

  return true;
}
