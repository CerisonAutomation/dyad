import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";
import { localWebFetch } from "./local_web_fetch";
import { assertNotPrivateIp } from "./network_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_crawl");

const MAX_PAGES = 8;
const MAX_CONTENT_PER_PAGE = 12_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_LINKS_PER_PAGE = 25;

const webCrawlSchema = z.object({
  url: z.string().describe("URL to crawl"),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGES)
    .optional()
    .describe(
      `How many pages to follow from the start URL (default 1, max ${MAX_PAGES}).`,
    ),
});

export const webCrawlResponseSchema = z.object({
  rootUrl: z.string(),
  html: z.string().optional(),
  markdown: z.string().optional(),
  screenshot: z.string().optional(),
});

const DESCRIPTION = `
Fetch a web page and, when asked, follow its links to gather content. Use this to read documentation or clone the structure of a site.

### When to use
- Reading multi-page documentation
- Cloning the shape of a site
- Gathering related content from a section

### When NOT to use
- You already know the exact URL — use \`web_fetch\`, which is faster
- You want a search — use the Exa or MultiFetch plugin

Pages are fetched with the same protections as \`web_fetch\`, so private and
internal addresses (localhost, link-local, RFC1918) are refused.
`;

/** Extract absolute http(s) links from fetched content. */
function extractLinks(content: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern = /https?:\/\/[^\s"'<>)\]]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) && out.length < MAX_LINKS_PER_PAGE) {
    let resolved: string;
    try {
      resolved = new URL(match[0]).toString();
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

async function crawl(
  startUrl: string,
  maxPages: number,
): Promise<z.infer<typeof webCrawlResponseSchema>> {
  await assertNotPrivateIp(startUrl);
  const root = new URL(startUrl);
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const sections: string[] = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);

    let page;
    try {
      page = await localWebFetch(next, {
        maxLength: MAX_CONTENT_PER_PAGE,
        timeout: FETCH_TIMEOUT_MS,
      });
    } catch (error) {
      logger.warn(`crawl skipped ${next}:`, (error as Error).message);
      continue;
    }
    if (!page?.content) continue;

    sections.push(
      `## ${page.title || next}\nSource: ${next}\n\n${page.content}`,
    );

    if (visited.size < maxPages) {
      for (const link of extractLinks(page.content, page.url || next)) {
        // Stay on the starting host: a crawl that wanders off-site is usually
        // an accident, and it multiplies the fetch cost.
        try {
          if (new URL(link).host !== root.host) continue;
        } catch {
          continue;
        }
        if (!visited.has(link)) queue.push(link);
      }
    }
  }

  if (sections.length === 0) {
    throw new DyadError(
      `Crawl of ${startUrl} returned no readable content.`,
      DyadErrorKind.NotFound,
    );
  }

  return { rootUrl: startUrl, markdown: sections.join("\n\n---\n\n") };
}

export const webCrawlTool: ToolDefinition = {
  name: "web_crawl",
  description: DESCRIPTION,
  inputSchema: webCrawlSchema,
  defaultConsent: "always",
  modifiesState: false,
  execute: async (args, ctx: AgentContext) => {
    ctx.onXmlStream(`<dyad-web-crawl url="${escapeXmlContent(args.url)}">`);
    try {
      const result = await crawl(args.url, args.maxPages ?? 1);
      ctx.onXmlComplete(`<dyad-web-crawl url="${escapeXmlContent(args.url)}">`);
      return result.markdown ?? "";
    } catch (error) {
      const message = (error as Error).message;
      ctx.onXmlComplete(
        `<dyad-web-crawl url="${escapeXmlContent(args.url)}" error="${escapeXmlContent(message)}" />`,
      );
      throw new DyadError(`Web crawl failed: ${message}`, DyadErrorKind.External, {
        cause: error,
      });
    }
  },
};
