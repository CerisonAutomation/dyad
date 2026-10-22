import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";
import { localWebFetch } from "./local_web_fetch";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_fetch");

function validateHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DyadError(`Invalid URL: ${url}`, DyadErrorKind.Validation);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DyadError(
      `Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`,
      DyadErrorKind.Validation,
    );
  }
}

const MAX_CONTENT_LENGTH = 500_000;

function truncateContent(value: string): string {
  if (value.length <= MAX_CONTENT_LENGTH) return value;
  return `${value.slice(0, MAX_CONTENT_LENGTH)}\n\n<!-- truncated -->`;
}

const webFetchSchema = z.object({
  url: z.string().describe("URL to fetch content from"),
});

const DESCRIPTION = `Fetch and read the content of a web page as markdown given its URL.

### When to Use This Tool
Use this tool when the user's message contains a URL (or domain name) and they want to:
- **Read** the page's content (e.g. documentation, blog post, article)
- **Reference** information from the page (e.g. API docs, tutorials, guides)
- **Extract** data or context from a live web page to inform their code
- **Follow a link** someone shared to understand its contents

Examples:
- "Use the docs at docs.example.com/api to set up the client"
- "What does this page say? https://example.com/blog/post"
- "Follow the guide at example.com/tutorial"

### When NOT to Use This Tool
- The user wants to **visually clone or replicate** a website → use \`web_crawl\` instead
- The user needs to **search the web** for information without a specific URL → use \`web_search\` instead
`;

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  defaultConsent: "always",

  // Local implementation - no engine required
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Fetch URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;
    if (isComplete) return undefined;
    return `<dyad-web-fetch>${escapeXmlContent(args.url)}`;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web fetch: ${args.url}`);

    ctx.onXmlStream(`<dyad-web-fetch>${escapeXmlContent(args.url)}`);

    try {
      validateHttpUrl(args.url);
      // Use local web fetch
      const result = await localWebFetch(args.url, {
        maxLength: MAX_CONTENT_LENGTH,
        timeout: 15000,
      });

      if (!result || !result.content) {
        throw new DyadError(
          "Web fetch returned no content",
          DyadErrorKind.NotFound,
        );
      }

      const content = `# ${result.title}\n\nURL: ${result.url}\nStatus: ${result.statusCode}\n\n---\n\n${result.content}`;

      logger.log(`Web fetch completed for URL: ${args.url}`);

      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );

      return truncateContent(content);
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );
      throw error;
    }
  },
};
