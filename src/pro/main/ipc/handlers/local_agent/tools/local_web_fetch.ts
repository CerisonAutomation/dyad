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
import { assertNotPrivateIpResolved } from "./network_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("local_web_fetch");

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  contentType: string;
  statusCode: number;
  /** Raw HTML of the page, truncated to `MAX_RESPONSE_BYTES`. */
  html?: string;
}

const MAX_REDIRECTS = 5;
const MAX_FETCH_ATTEMPTS = 3;
const FETCH_RETRY_BASE_DELAY_MS = 500;

/**
 * Hard cap on the number of body bytes read from a remote page.
 *
 * The extracted text is usually a few kilobytes, but the raw HTML of a large
 * page is not, and buffering all of it in the main process is wasteful.
 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Statuses worth a second attempt. A 5xx from a CDN or an upstream gateway
 * clears within seconds; a 4xx never will, and retrying it just burns the
 * turn's budget. 429 is deliberately excluded - it needs a longer backoff
 * than a retry can provide.
 */
const RETRYABLE_STATUS_CODES = new Set([408, 425, 500, 502, 503, 504]);

/**
 * Network-level failures that are safe to retry. These are transient
 * connection faults, not application errors.
 */
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new DyadError("Web fetch cancelled.", DyadErrorKind.UserCancelled),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new DyadError("Web fetch cancelled.", DyadErrorKind.UserCancelled),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    if (typeof code === "number") {
      return String(code);
    }
  }
  return undefined;
}

function isRetryableNetworkError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }
  // undici wraps the socket error in a `cause`.
  if (error && typeof error === "object" && "cause" in error) {
    return isRetryableNetworkError((error as { cause?: unknown }).cause);
  }
  return false;
}

/**
 * `true` when the failure is the request being aborted.
 *
 * A cancelled turn aborts the request and the rejection looks like any other
 * network error, so it has to be recognised explicitly: reporting it as an
 * upstream failure would blame the site for the user's own cancellation.
 */
function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (name === "AbortError") {
    return true;
  }
  const code = getErrorCode(error);
  return code === "ABORT_ERR" || code === "20";
}

/**
 * Map an HTTP failure onto the `DyadErrorKind` that matches its cause.
 *
 * A 404 from a third-party site is not a Dyad bug and must not be reported as
 * a product exception, so it is classified as `NotFound` (filtered). The same
 * holds for auth failures, rate limits and client errors. Only 5xx responses
 * and network faults stay `External` because those are genuine upstream
 * problems worth surfacing.
 */
function classifyHttpError(
  status: number,
  statusText: string,
  url: string,
): DyadError {
  const detail = `HTTP ${status}${statusText ? `: ${statusText}` : ""} - ${url}`;
  if (status === 404 || status === 410) {
    return new DyadError(
      `${detail}. The page was not found. Verify the URL, or use web_search to find the correct address.`,
      DyadErrorKind.NotFound,
    );
  }
  if (status === 401 || status === 403) {
    return new DyadError(
      `${detail}. The page requires authentication and could not be read.`,
      DyadErrorKind.Auth,
    );
  }
  if (status === 429) {
    return new DyadError(
      `${detail}. The site is rate limiting requests. Retry later.`,
      DyadErrorKind.RateLimited,
    );
  }
  if (RETRYABLE_STATUS_CODES.has(status)) {
    return new DyadError(
      `${detail}. The server returned a temporary error. This is usually transient - retry shortly.`,
      DyadErrorKind.External,
    );
  }
  if (status >= 500) {
    return new DyadError(
      `${detail}. The server returned an error. This is usually temporary - retry shortly.`,
      DyadErrorKind.External,
    );
  }
  return new DyadError(
    `${detail}. The server rejected the request.`,
    DyadErrorKind.Validation,
  );
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
    abortSignal?: AbortSignal;
  } = {},
): Promise<FetchResult> {
  const { maxLength = 5000, timeout = 15000 } = options;

  try {
    // Validate URL
    new URL(url);
    await assertNotPrivateIpResolved(url);

    logger.log(`Fetching URL: ${url}`);

    const fetchHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      "Accept-Language": "en-US,en;q=0.9",
    };

    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = options.abortSignal
      ? AbortSignal.any([options.abortSignal, timeoutSignal])
      : timeoutSignal;

    let lastError: DyadError | undefined;

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
      if (options.abortSignal?.aborted) {
        throw new DyadError(
          "Web fetch cancelled.",
          DyadErrorKind.UserCancelled,
        );
      }
      try {
        return await fetchAndExtract({
          url,
          fetchHeaders,
          signal,
          maxLength,
        });
      } catch (error) {
        if (error instanceof DyadError) {
          // Cancellation is terminal; a classified HTTP error is terminal
          // unless it is a retryable 5xx.
          if (error.kind === DyadErrorKind.UserCancelled) {
            throw error;
          }
          if (error.kind !== DyadErrorKind.External) {
            throw error;
          }
          lastError = error;
        } else if (options.abortSignal?.aborted || isAbortError(error)) {
          // A cancelled turn is not an upstream failure.
          throw new DyadError(
            "Web fetch cancelled.",
            DyadErrorKind.UserCancelled,
          );
        } else if (isRetryableNetworkError(error)) {
          lastError = new DyadError(
            `Failed to fetch URL: ${error instanceof Error ? error.message : "Unknown error"}`,
            DyadErrorKind.External,
          );
        } else {
          throw new DyadError(
            `Failed to fetch URL: ${error instanceof Error ? error.message : "Unknown error"}`,
            DyadErrorKind.External,
          );
        }

        if (attempt < MAX_FETCH_ATTEMPTS) {
          const retryDelayMs = FETCH_RETRY_BASE_DELAY_MS * attempt;
          logger.warn(
            `Fetch attempt ${attempt}/${MAX_FETCH_ATTEMPTS} failed for ${url}: ${lastError.message}. Retrying in ${retryDelayMs}ms.`,
          );
          await delay(retryDelayMs, options.abortSignal);
        }
      }
    }

    throw (
      lastError ??
      new DyadError(`Failed to fetch URL: ${url}`, DyadErrorKind.External)
    );
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

async function fetchAndExtract(params: {
  url: string;
  fetchHeaders: Record<string, string>;
  signal: AbortSignal;
  maxLength: number;
}): Promise<FetchResult> {
  const { url, fetchHeaders, signal, maxLength } = params;

  // Follow redirects manually, validating each target for SSRF
  let currentUrl = url;
  let response: Response | undefined;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    response = await fetch(currentUrl, {
      headers: fetchHeaders,
      signal,
      redirect: "manual",
    });
    if (REDIRECT_STATUS_CODES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      const redirectUrl = new URL(location, currentUrl).toString();
      await assertNotPrivateIpResolved(redirectUrl);
      currentUrl = redirectUrl;
    } else {
      break;
    }
  }

  if (!response) {
    throw new DyadError("No response received", DyadErrorKind.External);
  }

  if (REDIRECT_STATUS_CODES.has(response.status)) {
    // The redirect chain never ended on a readable page: either the limit was
    // reached or the last response had no `location` to follow. This is
    // terminal (the same chain would be followed again), so it is not
    // retried.
    throw new DyadError(
      `Too many redirects while fetching ${url} - the server answered HTTP ${response.status} and the redirect chain never reached a readable page.`,
      DyadErrorKind.Validation,
    );
  }

  if (!response.ok) {
    throw classifyHttpError(
      response.status,
      response.statusText,
      currentUrl === url ? url : `${url} (redirected to ${currentUrl})`,
    );
  }

  const contentType = response.headers.get("content-type") || "text/html";
  const html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);

  // Extract content based on type
  const extracted = extractContent(html, currentUrl, contentType);

  // Truncate if too long
  const truncatedContent =
    extracted.content.length > maxLength
      ? extracted.content.substring(0, maxLength) + "\n\n[Content truncated...]"
      : extracted.content;

  logger.log(
    `Fetched ${url}: ${truncatedContent.length} chars from ${html.length} HTML`,
  );

  return {
    url: currentUrl,
    title: extracted.title,
    content: truncatedContent,
    contentType,
    statusCode: response.status,
    html,
  };
}

/**
 * Read a response body with a hard byte cap.
 *
 * `response.text()` buffers the whole body in the main process even when only
 * the first few kilobytes are used, so the body is streamed and the reader is
 * cancelled as soon as the cap is reached.
 */
async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk: Uint8Array = value ?? new Uint8Array(0);
      received += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (received >= maxBytes) {
        truncated = true;
        break;
      }
    }
    text += decoder.decode();
  } finally {
    if (truncated) {
      // Drop the rest of the body instead of buffering it. Cancelling also
      // releases the reader lock.
      await reader.cancel().catch(() => undefined);
    } else {
      reader.releaseLock();
    }
  }
  return text;
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
