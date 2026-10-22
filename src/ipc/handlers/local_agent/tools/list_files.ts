import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { glob } from "glob";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { listCodebaseFileMetadata } from "../../../../utils/codebase";
import { resolveDirectoryWithinAppPath } from "./path_safety";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { isPathIgnoredByGitIgnore } from "@/ipc/utils/gitignore_utils";
import {
  DYAD_INTERNAL_GLOB,
  filterDyadInternalFiles,
  resolveTargetAppPath,
} from "./resolve_app_context";

const MAX_PATHS_TO_RETURN = 1_000;

/**
 * Directories the default (non-ignored) listing never shows. These mirror the
 * exclusions the codebase file collection applies, so a directory is not
 * listed in the default branch while its files are not listed either.
 */
const DEFAULT_EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
]);

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to list from instead of the current app. Omit to list the current app.",
    ),
  recursive: z
    .boolean()
    .optional()
    .describe("Whether to list files recursively (default: false)"),
  include_ignored: z
    .boolean()
    .optional()
    .describe(
      "Whether to include git-ignored and hidden files/directories such as node_modules (default: false).",
    ),
});

type ListFilesArgs = z.infer<typeof listFilesSchema>;

interface ListedPath {
  path: string;
  isDirectory: boolean;
}

function getDisplayPath(entry: ListedPath): string {
  return entry.isDirectory ? `${entry.path}/` : entry.path;
}

function sortListedPaths(entries: ListedPath[]): ListedPath[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });
}

function getXmlAttributes(args: ListFilesArgs, count?: number, total?: number) {
  const dirAttr = args.directory
    ? ` directory="${escapeXmlAttr(args.directory)}"`
    : "";
  const appNameAttr = args.app_name
    ? ` app_name="${escapeXmlAttr(args.app_name)}"`
    : "";
  const recursiveAttr =
    args.recursive !== undefined ? ` recursive="${args.recursive}"` : "";
  const includeIgnoredAttr =
    args.include_ignored !== undefined
      ? ` include_ignored="${args.include_ignored}"`
      : "";
  const countAttr = count !== undefined ? ` count="${count}"` : "";
  const totalAttr =
    total !== undefined && total > (count ?? 0) ? ` total="${total}"` : "";
  const truncatedAttr = totalAttr ? ` truncated="true"` : "";
  return `${dirAttr}${appNameAttr}${recursiveAttr}${includeIgnoredAttr}${countAttr}${totalAttr}${truncatedAttr}`;
}

/**
 * A path is hidden from the default listing when any of its segments starts
 * with a dot. The codebase file metadata is globbed without `dot: true`, so
 * hidden paths never appear there either.
 */
function hasHiddenSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Reject a directory that does not exist (or is not a directory).
 *
 * Without this check a typo'd directory globs to an empty list and the model
 * is told "(0 paths total)" instead of that the directory is missing.
 */
async function assertDirectoryExists({
  appPath,
  relativePath,
  requestedDirectory,
}: {
  appPath: string;
  relativePath: string;
  requestedDirectory: string;
}): Promise<void> {
  const fullPath = path.join(appPath, relativePath);
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(fullPath);
  } catch {
    throw new DyadError(
      `Directory not found: ${requestedDirectory}`,
      DyadErrorKind.NotFound,
    );
  }
  if (!stats.isDirectory()) {
    throw new DyadError(
      `Not a directory: ${requestedDirectory}`,
      DyadErrorKind.NotFound,
    );
  }
}

/**
 * List the directories the default listing should show for a scope.
 *
 * The codebase file metadata is collected with `nodir: true`, so directories
 * are never part of it. They are discovered here instead, keeping the default
 * listing's exclusions: git-ignored and hidden paths stay hidden unless
 * `include_ignored` is requested.
 *
 * @param appPath The target app path
 * @param scopeDir Absolute path of the directory being listed
 * @param scopePrefix App-relative prefix of the scope, used to build the
 *   returned app-relative paths
 * @param recursive Whether to include nested directories
 */
async function listVisibleDirectories({
  appPath,
  scopeDir,
  scopePrefix,
  recursive,
}: {
  appPath: string;
  scopeDir: string;
  scopePrefix: string;
  recursive: boolean;
}): Promise<string[]> {
  const directories: string[] = [];

  let realAppPath: string;
  let realScopeDir: string;
  try {
    realAppPath = await fs.promises.realpath(appPath);
    realScopeDir = await fs.promises.realpath(scopeDir);
  } catch {
    return directories;
  }

  // Canonicalize both the root and the target before comparing them, so a
  // symlinked scope cannot expose directories outside the app.
  const relativeToApp = path.relative(realAppPath, realScopeDir);
  if (relativeToApp.startsWith("..") || path.isAbsolute(relativeToApp)) {
    return directories;
  }

  if (hasHiddenSegment(scopePrefix)) {
    return directories;
  }

  const walk = async (
    currentDir: string,
    currentPrefix: string,
  ): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Symlinked directories are not followed, matching the file listing.
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (DEFAULT_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const relativePath = currentPrefix
        ? `${currentPrefix}/${entry.name}`
        : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      if (
        await isPathIgnoredByGitIgnore({
          basePath: realAppPath,
          filePath: fullPath,
          isDirectory: true,
        })
      ) {
        continue;
      }
      directories.push(relativePath);
      if (recursive) {
        await walk(fullPath, relativePath);
      }
    }
  };

  await walk(realScopeDir, scopePrefix);
  return directories;
}

export const listFilesTool: ToolDefinition<ListFilesArgs> = {
  name: "list_files",
  description:
    "List files in the application directory. By default, lists only the immediate directory contents. Use recursive=true to list all files recursively. Use include_ignored=true to include git-ignored and hidden paths; recursive ignored listings require directory to be set. Results are capped at 1000 paths.",
  inputSchema: listFilesSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const recursiveText = args.recursive ? " (recursive)" : "";
    const ignoredText = args.include_ignored ? " (include ignored)" : "";
    const appSuffix = args.app_name ? ` (app: ${args.app_name})` : "";
    const target = args.directory ?? "all files";
    return `List ${target}${recursiveText}${ignoredText}${appSuffix}`;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) {
      return undefined;
    }
    return `<dyad-list-files${getXmlAttributes(args)}></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    // Validate directory path to prevent path traversal attacks
    let sanitizedDirectory: string | undefined;
    if (args.directory) {
      const relativePathFromApp = resolveDirectoryWithinAppPath({
        appPath: targetAppPath,
        directory: args.directory,
      });

      await assertDirectoryExists({
        appPath: targetAppPath,
        relativePath: relativePathFromApp,
        requestedDirectory: args.directory,
      });

      // Normalize for glob usage (glob treats "\" as an escape on Windows)
      const normalizedRelativePath = relativePathFromApp
        .split(path.sep)
        .join("/")
        .replace(/\\/g, "/");

      // Empty means "root"
      sanitizedDirectory = normalizedRelativePath || undefined;
    }

    if (args.include_ignored && args.recursive && !sanitizedDirectory) {
      throw new DyadError(
        "include_ignored=true with recursive=true requires a non-root directory to avoid listing too many files.",
        DyadErrorKind.Validation,
      );
    }

    // Use "**" for recursive, "*" for non-recursive (immediate children only)
    const globSuffix = args.recursive ? "/**" : "/*";
    const globPath = sanitizedDirectory
      ? sanitizedDirectory + globSuffix
      : globSuffix.slice(1); // Remove leading "/" for root directory

    let allPaths: ListedPath[];

    if (args.include_ignored) {
      const normalizedAppPath = targetAppPath.replace(/\\/g, "/");
      const globPattern = `${normalizedAppPath}/${globPath}`;
      const ignoredGlobs = args.app_name
        ? ["**/.git", "**/.git/**", DYAD_INTERNAL_GLOB]
        : ["**/.git", "**/.git/**"];
      const ignoredPaths = await glob(globPattern, {
        withFileTypes: true,
        dot: true,
        ignore: ignoredGlobs,
      });

      allPaths = sortListedPaths(
        ignoredPaths.map((entry) => ({
          path: path
            .relative(targetAppPath, entry.fullpath())
            .split(path.sep)
            .join("/"),
          isDirectory: entry.isDirectory(),
        })),
      );
    } else {
      const { files } = await listCodebaseFileMetadata({
        appPath: targetAppPath,
        chatContext: {
          contextPaths: [{ globPath }],
          smartContextAutoIncludes: [],
          excludePaths: [],
        },
      });

      const filteredFiles = filterDyadInternalFiles(files, args.app_name);

      // The codebase file metadata is collected with `nodir: true`, so it
      // never contains directories. Discover them separately so the default
      // listing shows the same directories the include_ignored listing does.
      const directories = await listVisibleDirectories({
        appPath: targetAppPath,
        scopeDir: sanitizedDirectory
          ? path.join(targetAppPath, sanitizedDirectory)
          : targetAppPath,
        scopePrefix: sanitizedDirectory ?? "",
        recursive: Boolean(args.recursive),
      });

      // Build the list of file paths
      allPaths = sortListedPaths([
        ...directories.map((directory) => ({
          path: directory,
          isDirectory: true,
        })),
        ...filteredFiles.map((file) => ({
          path: file.path,
          isDirectory: false,
        })),
      ]);
    }

    const totalCount = allPaths.length;
    const cappedPaths = allPaths.slice(0, MAX_PATHS_TO_RETURN);
    const wasTruncated = totalCount > cappedPaths.length;

    // Build full file list for LLM
    const allFilesList =
      cappedPaths.map((entry) => " - " + getDisplayPath(entry)).join("\n") ||
      "";
    const resultText = wasTruncated
      ? `${allFilesList}\n\n[TRUNCATED: Showing ${cappedPaths.length} of ${totalCount} paths. Use directory to narrow the listing.]`
      : allFilesList;

    // Build abbreviated list for UI display
    const MAX_FILES_TO_SHOW = 20;
    const displayedFiles = cappedPaths.slice(0, MAX_FILES_TO_SHOW);
    const abbreviatedList =
      displayedFiles.map((entry) => " - " + getDisplayPath(entry)).join("\n") ||
      "";
    const countInfo =
      totalCount > MAX_FILES_TO_SHOW
        ? `\n... and ${totalCount - MAX_FILES_TO_SHOW} more paths (${totalCount} total)`
        : `\n(${totalCount} paths total)`;

    // Write abbreviated list to UI
    ctx.onXmlComplete(
      `<dyad-list-files${getXmlAttributes(args, cappedPaths.length, totalCount)}>${escapeXmlContent(abbreviatedList + countInfo)}</dyad-list-files>`,
    );

    // Return full file list for LLM
    return resultText;
  },
};
