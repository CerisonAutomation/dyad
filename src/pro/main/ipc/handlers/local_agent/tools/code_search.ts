import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { localCodeSearch } from "./local_code_search";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { isCodeExplorerReady } from "@/ipc/processors/code_explorer";
import { resolveTargetAppPath } from "./resolve_app_context";

const logger = log.scope("code_search");

const codeSearchSchema = z.object({
  query: z.string().describe("Search query to find relevant files"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

type CodeSearchArgs = z.infer<typeof codeSearchSchema>;

function buildCodeSearchAttributes(args: Partial<CodeSearchArgs>) {
  const queryAttr = args.query ? ` query="${escapeXmlAttr(args.query)}"` : "";
  const appNameAttr = args.app_name
    ? ` app_name="${escapeXmlAttr(args.app_name)}"`
    : "";
  return `${queryAttr}${appNameAttr}`;
}

const DESCRIPTION = `Search the codebase semantically to find files relevant to a query. Use this tool when you need to discover which files contain code related to a specific concept, feature, or functionality. Returns a list of file paths that are most relevant to the search query.

### When to Use This Tool

- Explore unfamiliar codebases
- Ask "how / where / what" questions to understand behavior
- Find code by meaning rather than exact text

### When NOT to Use

Skip this tool for:
1. Exact text matches (use \`grep\`)
2. Reading known files (use \`read_file\`)
3. Simple symbol lookups (use \`grep\`)
`;

export const codeSearchTool: ToolDefinition<CodeSearchArgs> = {
  name: "code_search",
  description: DESCRIPTION,
  inputSchema: codeSearchSchema,
  defaultConsent: "always",

  // Available when code explorer is not active (fallback tool for all users)
  isEnabled: (ctx) =>
    !(readSettings().enableCodeExplorer && isCodeExplorerReady(ctx.appPath)),

  getConsentPreview: (args) =>
    args.app_name
      ? `Search for "${args.query}" (app: ${args.app_name})`
      : `Search for "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-code-search${buildCodeSearchAttributes(args)}>Searching...</dyad-code-search>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing code search: ${args.query}`);
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    ctx.onXmlStream(
      `<dyad-code-search${buildCodeSearchAttributes({
        query: args.query,
        app_name: args.app_name,
      })}>`,
    );

    try {
      // Tokenized search: multi-word queries ("authentication middleware")
      // rarely match a literal phrase, so search each term separately and
      // also match file paths. Falls back to the full-phrase literal search.
      const results = await tokenizedCodeSearch(args.query, targetAppPath);

      // Format results
      const resultText =
        results.length === 0
          ? "No relevant files found."
          : results
              .map(
                (r) =>
                  ` - ${r.file}:${r.line} — ${r.content.substring(0, 100)}`,
              )
              .join("\n");

      // Write final result to UI
      ctx.onXmlComplete(
        `<dyad-code-search${buildCodeSearchAttributes(args)}>${escapeXmlContent(resultText)}</dyad-code-search>`,
      );

      logger.log(`Code search completed for query: ${args.query}`);

      if (results.length === 0) {
        return "No relevant files found for the given query.";
      }

      return `Found ${results.length} relevant match(es):\n${resultText}`;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Code search failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};

/**
 * Tokenized search: splits a natural-language query into terms and searches
 * both file contents and file paths for each term, then ranks/dedupes.
 * Falls back to a full-phrase literal search when the query yields nothing.
 */
async function tokenizedCodeSearch(
  query: string,
  appPath: string,
): Promise<Awaited<ReturnType<typeof localCodeSearch>>> {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9_./-]+/g, ""))
    .filter((t) => t.length >= 2);

  const byKey = new Map<
    string,
    Awaited<ReturnType<typeof localCodeSearch>>[number]
  >();

  const addResult = (
    r: Awaited<ReturnType<typeof localCodeSearch>>[number],
  ) => {
    const key = `${r.file}:${r.line}`;
    const existing = byKey.get(key);
    if (!existing || r.score > existing.score) byKey.set(key, r);
  };

  for (const token of tokens.slice(0, 6)) {
    const termResults = await localCodeSearch({
      query: token,
      appPath,
      maxResults: 12,
    });
    termResults.forEach(addResult);
  }

  // Path-based matching: a query term appearing in the file path is highly
  // relevant (e.g. "middleware" → middleware.ts, "auth" → src/app/api/auth/).
  if (tokens.length > 0) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync("rg", ["--files", appPath], {
        cwd: appPath,
        timeout: 8000,
      });
      const lowerTokens = tokens.map((t) => t.toLowerCase());
      for (const file of stdout.split("\n").filter(Boolean)) {
        const lower = file.toLowerCase();
        if (
          lowerTokens.some((t) => lower.includes(t)) &&
          !lower.includes("node_modules")
        ) {
          addResult({
            file,
            line: 1,
            content: "(path match)",
            matchType: "fuzzy",
            score: 0.95,
          });
        }
      }
    } catch {
      // rg unavailable — skip path matching
    }
  }

  const results = [...byKey.values()].sort((a, b) => b.score - a.score);
  if (results.length > 0) return results.slice(0, 20);

  // Nothing matched — try the raw phrase once before giving up.
  return localCodeSearch({ query, appPath, maxResults: 20 });
}
