/**
 * Local Web Fetch - Fetch and extract content from URLs
 * Replaces Dyad Engine web crawl with free, no-API-key alternatives
 *
 * Features:
 * - Built-in fetch (zero dependencies)
 * - HTML to text conversion
 * - Content extraction
 * - Graceful degradation
 */

import log from "electron-log";
import { assertNotPrivateIp } from "./network_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("local_web_fetch");

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  contentType: string;
  statusCode: number;
}

/**
 * Fetch and extract content from a URL
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @returns Extracted content
 */
export async function localWebFetch(
  url: string,
  options: {
    maxLength?: number;
    timeout?: number;
  } = {},
): Promise<FetchResult> {
  const { maxLength = 5000, timeout = 15000 } = options;

  try {
    // Validate URL
    new URL(url);
    assertNotPrivateIp(url);

    logger.log(`Fetching URL: ${url}`);

    const fetchHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // Follow redirects manually, validating each target for SSRF
    let currentUrl = url;
    let response: Response | undefined;
    for (let i = 0; i < 5; i++) {
      response = await fetch(currentUrl, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(timeout),
        redirect: "manual",
      });
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        const redirectUrl = new URL(location, currentUrl).toString();
        assertNotPrivateIp(redirectUrl);
        currentUrl = redirectUrl;
      } else {
        break;
      }
    }

    if (!response) {
      throw new DyadError("No response received", DyadErrorKind.External);
    }

    if (!response.ok) {
      throw new DyadError(
        `HTTP ${response.status}: ${response.statusText}`,
        DyadErrorKind.External,
      );
    }

    const contentType = response.headers.get("content-type") || "text/html";
    const html = await response.text();

    // Extract content based on type
    const extracted = extractContent(html, url, contentType);

    // Truncate if too long
    const truncatedContent =
      extracted.content.length > maxLength
        ? extracted.content.substring(0, maxLength) +
          "\n\n[Content truncated...]"
        : extracted.content;

    logger.log(
      `Fetched ${url}: ${truncatedContent.length} chars from ${html.length} HTML`,
    );

    return {
      url,
      title: extracted.title,
      content: truncatedContent,
      contentType,
      statusCode: response.status,
    };
  } catch (error) {
    logger.error(`Failed to fetch ${url}:`, error);
    // Re-throw DyadError as-is to preserve the original error kind
    if (error instanceof DyadError) {
      throw error;
    }
    throw new DyadError(
      `Failed to fetch URL: ${error instanceof Error ? error.message : "Unknown error"}`,
      DyadErrorKind.External,
    );
  }
}

/**
 * Extract content from HTML
 */
function extractContent(
  html: string,
  url: string,
  _contentType: string,
): { title: string; content: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  // Remove script and style tags
  let cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  // Extract main content areas
  const mainContent = extractMainContent(cleanHtml);

  // Convert HTML to text
  const text = htmlToText(mainContent);

  return { title, content: text };
}

/**
 * Extract main content from HTML (skip navigation, sidebars, etc.)
 */
function extractMainContent(html: string): string {
  // Try to find main content area
  const mainPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of mainPatterns) {
    const match = html.match(pattern);
    if (match && match[1].length > 100) {
      return match[1];
    }
  }

  // Fallback: use body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

/**
 * Convert HTML to plain text
 */
function htmlToText(html: string): string {
  return (
    html
      // Replace block elements with newlines
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<\/tr>/gi, "\n")
      // Remove all HTML tags
      .replace(/<[^>]*>/g, "")
      // Decode HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Clean up whitespace
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

/**
 * Format fetch results for display
 */
export function formatFetchResult(result: FetchResult): string {
  return `**${result.title}**\nURL: ${result.url}\nStatus: ${result.statusCode}\n\n${result.content}`;
}
