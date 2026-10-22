/**
 * Local Web Search - Multi-provider parallel search with deduplication
 * Replaces Dyad Engine web search with free, no-API-key alternatives
 *
 * Providers:
 * - DuckDuckGo HTML scraping (primary)
 * - SearXNG public instances (fallback)
 * - Built-in fetch (zero dependencies)
 */

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("local_web_search");

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  score: number; // Relevance score 0-1
}

// SearXNG public instances (free, no auth required)
/**
 * Public SearXNG instances have largely disabled the JSON API (they answer
 * HTML, or 403/429, regardless of `format=json`), so this list is a best-effort
 * supplement only — never the only path. Verified dead: bus-hit.me and
 * searxng.ch (no response), searx.be / sapti.me (HTML despite format=json),
 * searx.tiekoetter.com, priv.au (429), searxng.site (403).
 */
const SEARXNG_INSTANCES: string[] = ["http://127.0.0.1:8888"];

/**
 * Deadline for a single provider request.
 *
 * The provider requests always carry a deadline: the turn signal alone would
 * let a hung provider block the tool for the whole turn.
 */
const PROVIDER_TIMEOUT_MS = 12_000;

/**
 * Combine the caller's cancellation signal with a request deadline.
 */
function providerSignal(abortSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal;
}

/**
 * Rethrow a cancelled request as a `UserCancelled` error.
 *
 * The caller's signal is the only authority here: the provider deadline
 * aborts the request too, and that is a provider failure, not a cancelled
 * turn.
 */
function throwIfCancelled(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted) {
    throw new DyadError("Web search cancelled.", DyadErrorKind.UserCancelled);
  }
}

/**
 * Multi-provider parallel web search with deduplication
 * @param query - The search query
 * @param maxResults - Maximum number of results to return (default: 8)
 * @returns Deduplicated and ranked search results
 */
export async function localWebSearch(
  query: string,
  maxResults: number = 8,
  abortSignal?: AbortSignal,
): Promise<SearchResult[]> {
  const startTime = Date.now();

  // Check abort before starting
  if (abortSignal?.aborted) {
    throw new DyadError("Web search cancelled.", DyadErrorKind.UserCancelled);
  }

  // Launch parallel searches across providers
  const searchPromises = [
    // Firecrawl's keyless endpoint is the most reliable of the keyless options:
    // it returns real JSON results with no API key and is not bot-gated.
    searchFirecrawl(query, maxResults, abortSignal),
    searchDuckDuckGoLite(query, maxResults, abortSignal),
    searchDuckDuckGoHtml(query, maxResults, abortSignal),
    ...SEARXNG_INSTANCES.map((instance) =>
      searchSearXNG(instance, query, maxResults, abortSignal),
    ),
  ];

  // Use Promise.allSettled for fault-tolerant parallel execution
  const results = await Promise.allSettled(searchPromises);

  // A cancelled turn is not a missing backend: surface the cancellation
  // instead of reporting that no search backend is reachable.
  for (const result of results) {
    if (
      result.status === "rejected" &&
      result.reason instanceof DyadError &&
      result.reason.kind === DyadErrorKind.UserCancelled
    ) {
      throw result.reason;
    }
  }
  if (abortSignal?.aborted) {
    throw new DyadError("Web search cancelled.", DyadErrorKind.UserCancelled);
  }

  // Collect all successful results
  const allResults: SearchResult[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      allResults.push(...result.value);
    }
  }

  // Providers overlap heavily, so collapse duplicates by URL keeping the
  // highest-scoring copy.
  const byUrl = new Map<string, SearchResult>();
  for (const result of allResults) {
    const key = result.url.replace(/#.*$/, "");
    const existing = byUrl.get(key);
    if (!existing || result.score > existing.score) byUrl.set(key, result);
  }
  const deduped = [...byUrl.values()].sort((a, b) => b.score - a.score);

  if (deduped.length > 0) return deduped.slice(0, maxResults);

  if (allResults.length === 0) {
    throw new DyadError(
      "No keyless web-search backend is reachable right now: the public " +
        "SearXNG instances have disabled their JSON API and DuckDuckGo's " +
        "HTML endpoint is serving a bot challenge. Use the Exa or MultiFetch " +
        "MCP plugin for search, or fetch a specific URL with web_fetch.",
      DyadErrorKind.External,
    );
  }

  // Deduplicate by URL
  const deduplicated = deduplicateResults(allResults);

  // Sort by relevance score
  const sorted = deduplicated.sort((a, b) => b.score - a.score);

  const elapsed = Date.now() - startTime;
  logger.log(
    `Web search completed: ${sorted.length} results from ${allResults.length} total in ${elapsed}ms`,
  );

  return sorted.slice(0, maxResults);
}

/**
 * Search DuckDuckGo via HTML endpoint (no API key required)
 */
/**
 * Firecrawl's keyless search endpoint. No API key, returns JSON, and is not
 * bot-gated — the best available keyless option as of 2026.
 */
async function searchFirecrawl(
  query: string,
  maxResults: number,
  abortSignal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: Math.min(maxResults, 10) }),
      signal: providerSignal(abortSignal),
    });
    if (!response.ok) {
      logger.warn(`Firecrawl returned ${response.status}`);
      return [];
    }
    const payload = (await response.json()) as {
      data?: Array<{ url?: string; title?: string; description?: string }>;
    };
    const results = (payload.data ?? [])
      .filter((row) => row.url)
      .map((row) => ({
        title: row.title ?? row.url!,
        url: row.url!,
        snippet: (row.description ?? "").replace(/\s+/g, " ").trim(),
        provider: "firecrawl",
        score: 0.9,
      }));
    return results.slice(0, maxResults);
  } catch (error) {
    throwIfCancelled(abortSignal);
    logger.error("Firecrawl search failed:", error);
    return [];
  }
}

/**
 * DuckDuckGo's "lite" endpoint. The main html endpoint answers a bot challenge;
 * lite does not, and it emits a flat, easily-parsed result list.
 */
async function searchDuckDuckGoLite(
  query: string,
  maxResults: number,
  abortSignal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
        signal: providerSignal(abortSignal),
      },
    );
    if (!response.ok) return [];
    const html = await response.text();
    const results: SearchResult[] = [];
    // lite pairs each result link with a following snippet block.
    const linkPattern =
      /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) && results.length < maxResults) {
      let url = match[1];
      // lite wraps outbound links in a redirector.
      const redirect = url.match(/uddg=([^&]+)/);
      if (redirect) url = decodeURIComponent(redirect[1]);
      if (!url.startsWith("http")) continue;
      const snippet =
        html
          .slice(match.index, match.index + 900)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300) || "";
      results.push({
        title: match[2].replace(/<[^>]+>/g, " ").trim(),
        url,
        snippet,
        provider: "duckduckgo-lite",
        score: 0.8,
      });
    }
    return results;
  } catch (error) {
    throwIfCancelled(abortSignal);
    logger.error("DuckDuckGo lite search failed:", error);
    return [];
  }
}

async function searchDuckDuckGoHtml(
  query: string,
  maxResults: number,
  abortSignal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodedQuery}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: providerSignal(abortSignal),
      },
    );

    if (!response.ok) {
      logger.warn(`DuckDuckGo returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseDuckDuckGoHtml(html, maxResults);
  } catch (error) {
    throwIfCancelled(abortSignal);
    logger.error("DuckDuckGo search failed:", error);
    return [];
  }
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Extract results using regex (no cheerio dependency)
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;

  let match;
  while (
    (match = resultRegex.exec(html)) !== null &&
    results.length < maxResults
  ) {
    let url = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();

    // Decode DuckDuckGo redirect URLs
    if (url.includes("uddg=")) {
      const urlMatch = url.match(/uddg=([^&]+)/);
      if (urlMatch) {
        url = decodeURIComponent(urlMatch[1]);
      }
    }

    if (url && title && !url.startsWith("/")) {
      results.push({
        title,
        url,
        snippet: snippet || "",
        provider: "duckduckgo",
        score: calculateRelevanceScore(title, snippet, ""),
      });
    }
  }

  return results;
}

/**
 * Search SearXNG public instance
 */
async function searchSearXNG(
  instance: string,
  query: string,
  maxResults: number,
  abortSignal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `${instance}/search?q=${encodedQuery}&categories=general`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh)",
          Accept: "text/html",
        },
        signal: providerSignal(abortSignal),
      },
    );

    if (!response.ok) {
      logger.warn(`SearXNG ${instance} returned ${response.status}`);
      return [];
    }

    // The self-hosted instance serves HTML: its public counterparts refuse the
    // JSON API, which is the whole reason we run our own.
    const html = await response.text();
    const results: SearchResult[] = [];
    const pattern = /<h3><a href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) && results.length < maxResults) {
      const url = match[1];
      if (!url || url.startsWith("http://127.0.0.1")) continue;
      // Snippet sits in the result_content block that follows the heading.
      const tail = html.slice(match.index, match.index + 1200);
      const snippetMatch = tail.match(/class="content"[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = snippetMatch
        ? snippetMatch[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : "";
      results.push({
        title: match[2]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        url,
        snippet,
        provider: "searxng-local",
        // Ranked above the hosted keyless providers: this instance is the
        // user's own, so it has no third party, no quota, and no ranking cap.
        score: 0.95,
      });
    }
    return results;
  } catch (error) {
    throwIfCancelled(abortSignal);
    logger.error(`SearXNG ${instance} search failed:`, error);
    return [];
  }
}

/**
 * Deduplicate results by URL, keeping the highest-scored version
 */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);
    const existing = seen.get(normalizedUrl);

    if (!existing || result.score > existing.score) {
      seen.set(normalizedUrl, result);
    }
  }

  return Array.from(seen.values());
}

/**
 * Normalize URL for deduplication
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, normalize protocol
    return `${parsed.hostname}${parsed.pathname}`
      .toLowerCase()
      .replace(/\/$/, "");
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Calculate relevance score based on title and snippet matching
 */
function calculateRelevanceScore(
  title: string,
  snippet: string,
  _query: string,
): number {
  let score = 0.5; // Base score

  // Title length bonus (shorter is often more relevant)
  if (title.length < 60) score += 0.1;
  if (title.length < 40) score += 0.1;

  // Snippet length bonus
  if (snippet.length > 50) score += 0.1;
  if (snippet.length > 100) score += 0.1;

  // Penalty for very short content
  if (title.length < 10) score -= 0.2;
  if (snippet.length < 20) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n   [via ${r.provider}]`,
    )
    .join("\n\n");
}
