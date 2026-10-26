import fs from "node:fs";
import path from "node:path";

/** Explicit user-selected project directory. Never infer the current chat's
 * root for a globally shared MCP connection or interpolate values into a shell.
 */
export function resolveMcpWorkingDirectory(
  catalogSlug: string | null | undefined,
  env?: Record<string, string>,
): string | undefined {
  const supplied = env?.DYAD_MCP_PROJECT_DIR;
  if (!supplied) {
    if (catalogSlug === "shadcn-ui-registry")
      throw new Error(
        "Set DYAD_MCP_PROJECT_DIR to the absolute project directory before connecting shadcn MCP",
      );
    return undefined;
  }
  if (
    supplied.length > 4096 ||
    !path.isAbsolute(supplied) ||
    supplied.includes("\0")
  )
    throw new Error("MCP project directory must be an absolute directory path");
  try {
    const directory = fs.realpathSync(supplied);
    if (!fs.statSync(directory).isDirectory())
      throw new Error("Not a directory");
    return directory;
  } catch {
    throw new Error(
      "MCP project directory is missing, inaccessible or not a directory",
    );
  }
}
