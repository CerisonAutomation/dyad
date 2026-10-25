import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";
import { searchLocalCode } from "@/ipc/utils/local_code_search";
import { isCodeExplorerReady } from "@/ipc/processors/code_explorer";
import { readSettings } from "@/main/settings";
import {
  filterDyadInternalFiles,
  resolveTargetAppPath,
} from "./resolve_app_context";

const logger = log.scope("code_search");

const codeSearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("Search query to find relevant files"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

const FileContextSchema = z.object({
  path: z.string(),
  content: z.string(),
});

type CodeSearchArgs = z.infer<typeof codeSearchSchema>;

function buildCodeSearchAttributes(args: Partial<CodeSearchArgs>) {
  const queryAttr = args.query ? ` query="${escapeXmlAttr(args.query)}"` : "";
  const appNameAttr = args.app_name
    ? ` app_name="${escapeXmlAttr(args.app_name)}"`
    : "";
  return `${queryAttr}${appNameAttr}`;
}

async function callCodeSearch(
  params: {
    query: string;
    app_name?: string;
    filesContext: z.infer<typeof FileContextSchema>[];
  },
  ctx: AgentContext,
): Promise<string[]> {
  // Stream initial state to UI
  ctx.onXmlStream(
    `<dyad-code-search${buildCodeSearchAttributes({
      query: params.query,
      app_name: params.app_name,
    })}>`,
  );

  ctx.abortSignal?.throwIfAborted();
  const result = searchLocalCode(params.query, params.filesContext);
  if (result.truncated)
    logger.warn("Local code search reached its bounded indexing budget");
  return result.results.map((file) => file.path);
}

const DESCRIPTION = `Search the codebase locally using exact terms, path matches, symbols and fuzzy matching. This is lexical retrieval, not embedding-based semantic search. No source code leaves this machine. Use this tool when you need to discover which files contain code related to a specific concept, feature, or functionality. Returns a list of file paths that are most relevant to the search query.

### When to Use This Tool

- Explore unfamiliar codebases
- Ask "how / where / what" questions to understand behavior
- Rank candidate files using words, paths and symbol names

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
  usesEngineEndpoint: false,

  // Route root discovery through the Explorer sub-agent whenever it is
  // available. Inside Explorer, retain code_search as a fallback unless the
  // compiler-backed exploration surface is ready.
  isEnabled: () => true,
  isDiscoverable: (ctx) => {
    if (!ctx.subagentThreadId && ctx.canUseExplorerSubagent) return false;

    const exploreCodeAvailable =
      ctx.subagentPersona === "explorer" &&
      readSettings().enableCodeExplorer === true &&
      isCodeExplorerReady(ctx.appPath);
    return !exploreCodeAvailable;
  },

  getConsentPreview: (args) =>
    args.app_name
      ? `Search for "${args.query}" (app: ${args.app_name})`
      : `Search for "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-code-search${buildCodeSearchAttributes(args)}>Searching...`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing code search: ${args.query}`);
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    // Gather all files from the project
    const { files } = await extractCodebase({
      appPath: targetAppPath,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
        excludePaths: [],
      },
    });

    const filteredFiles = filterDyadInternalFiles(files, args.app_name);

    // Map files to FileContext format
    const filesContext = filteredFiles.map((file) => ({
      path: file.path,
      content: file.content,
    }));

    logger.log(
      `Searching ${filesContext.length} files for query: "${args.query}"`,
    );

    // Rank extracted files on this machine (no network request)
    const relevantFiles = await callCodeSearch(
      {
        query: args.query,
        app_name: args.app_name,
        filesContext,
      },
      ctx,
    );

    // Format results
    const resultText =
      relevantFiles.length === 0
        ? "No relevant files found."
        : relevantFiles.map((f) => ` - ${f}`).join("\n");

    // Write final result to UI and DB with dyad-code-search wrapper
    ctx.onXmlComplete(
      `<dyad-code-search${buildCodeSearchAttributes(args)}>${escapeXmlContent(resultText)}</dyad-code-search>`,
    );

    logger.log(`Code search completed for query: ${args.query}`);

    if (relevantFiles.length === 0) {
      return "No relevant files found for the given query.";
    }

    return `Found ${relevantFiles.length} relevant file(s):\n${resultText}`;
  },
};
