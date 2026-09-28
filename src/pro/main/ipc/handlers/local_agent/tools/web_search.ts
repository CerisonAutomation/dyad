import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { localWebSearch } from "./local_web_search";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_search");

const webSearchSchema = z.object({
  query: z.string().describe("The search query to look up on the web"),
});

const DESCRIPTION = `
Use this tool to access real-time information beyond your training data cutoff.

When to Search:
- Current API documentation, library versions, or breaking changes
- Latest best practices, security advisories, or bug fixes
- Specific error messages or troubleshooting solutions
- Recent framework updates or deprecation notices

Query Tips:
- Be specific: Include version numbers, exact error messages, or technical terms
- Add context: "React 19 useEffect cleanup" not just "React hooks"

Examples:

<example>
OpenAI GPT-5 API model names
</example>

<example>
NextJS 14 app router middleware auth
</example>
`;

export const webSearchTool: ToolDefinition<z.infer<typeof webSearchSchema>> = {
  name: "web_search",
  description: DESCRIPTION,
  inputSchema: webSearchSchema,
  defaultConsent: "ask",

  // Local implementation - no engine required
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Search the web: "${args.query}"`,

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing web search: ${args.query}`);
    ctx.onXmlStream(`<dyad-web-search query="${escapeXmlAttr(args.query)}">`);

    try {
      // Use local web search (DuckDuckGo + SearXNG)
      const results = await localWebSearch(args.query, 10);

      if (results.length === 0) {
        throw new DyadError(
          "Web search returned no results",
          DyadErrorKind.External,
        );
      }

      // Format results as markdown
      let resultText = `## Search Results for: ${args.query}\n\n`;
      resultText += `Found ${results.length} results:\n\n`;

      results.forEach((r, i) => {
        resultText += `### ${i + 1}. ${r.title}\n`;
        resultText += `URL: ${r.url}\n`;
        resultText += `${r.snippet}\n`;
        resultText += `*[via ${r.provider}]*\n\n`;
      });

      // Write final result to UI
      ctx.onXmlComplete(
        `<dyad-web-search query="${escapeXmlAttr(args.query)}">${escapeXmlContent(resultText)}</dyad-web-search>`,
      );

      logger.log(`Web search completed for query: ${args.query}`);
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
