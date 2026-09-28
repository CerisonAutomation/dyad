import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { optimizeLazyEdits } from "@/ipc/utils/local_lazy_edits";
import type { CodebaseFile } from "@/utils/codebase";

const logger = log.scope("local_lazy_edits");

const lazyEditsSchema = z.object({
  response: z
    .string()
    .describe("The LLM response containing file edits to optimize"),
  aggressive: z
    .boolean()
    .optional()
    .describe("Use aggressive optimization (default: false)"),
});

const DESCRIPTION = `
Optimize file edits by converting full rewrites to targeted search-replace diffs.

### When to Use
- After generating code changes, to reduce token usage
- When the model outputs full file rewrites instead of diffs
- To improve edit precision and reduce errors

### How It Works
1. Detects full file rewrites (<dyad-write> blocks)
2. Compares with original files
3. Generates targeted search-replace diffs
4. Estimates token savings

### Output Format
Returns optimized response with search-replace blocks:
\`\`\`
<<<<<<< SEARCH
[exact content to find]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`
`;

export const localLazyEditsTool: ToolDefinition<
  z.infer<typeof lazyEditsSchema>
> = {
  name: "local_lazy_edits",
  description: DESCRIPTION,
  inputSchema: lazyEditsSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    `Optimize ${args.response.length} chars of edits`,

  buildXml: (args, isComplete) => {
    if (!args.response) return undefined;
    if (isComplete) return undefined;
    return `<dyad-lazy-edits>Optimizing...</dyad-lazy-edits>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing lazy edits optimization`);

    ctx.onXmlStream(`<dyad-lazy-edits>Analyzing edits...</dyad-lazy-edits>`);

    try {
      const files: CodebaseFile[] = (ctx as any).codebaseFiles || [];

      const result = optimizeLazyEdits({
        response: args.response,
        files,
        aggressive: args.aggressive || false,
      });

      ctx.onXmlComplete(
        `<dyad-lazy-edits original="${result.originalRewrites}" optimized="${result.optimizedReplaces}" savings="${result.tokenSavings}">\n${escapeXmlContent(result.optimizedEdits)}\n</dyad-lazy-edits>`,
      );

      return result.optimizedEdits;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Lazy edits optimization failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
