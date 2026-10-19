/**
 * Shared Fuse.js search utilities for Dyad tools.
 *
 * Patterns sourced from production codebases:
 * - Uniswap: separate options per search type
 * - LobeHub: threshold 0.35, ignoreLocation for descriptions
 * - Dendron: shouldSort, distance 15, minMatchCharLength 1
 * - Obsidian: fieldNormWeight 1.35 for tight matching
 * - YCS: signature-based Fuse instance caching
 */

import Fuse, { type IFuseOptions } from "fuse.js";

// ─── Preset Configurations ───────────────────────────────────────────────────

/** Code search: fuzzy matching on file paths + content (LobeHub pattern) */
export const CODE_SEARCH_OPTIONS: IFuseOptions<{
  filePath: string;
  line: number;
  content: string;
}> = {
  keys: [
    { name: "content", weight: 0.6 },
    { name: "filePath", weight: 0.3 },
  ],
  threshold: 0.4,
  distance: 200,
  includeScore: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
};

/** Smart context: ranking files by relevance to a goal (Dendron pattern) */
export const SMART_CONTEXT_OPTIONS: IFuseOptions<{
  path: string;
  content: string;
  exportCount: number;
  importCount: number;
  lineCount: number;
}> = {
  keys: [
    { name: "content", weight: 0.5 },
    { name: "path", weight: 0.4 },
    { name: "exportCount", weight: 0.05 },
    { name: "importCount", weight: 0.05 },
  ],
  threshold: 0.35,
  distance: 150,
  includeScore: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
  shouldSort: true,
};

/** Symbol search: tight matching on identifiers (Obsidian pattern) */
export const SYMBOL_SEARCH_OPTIONS: IFuseOptions<{
  name: string;
  type: string;
  filePath: string;
  line: number;
}> = {
  keys: [
    { name: "name", weight: 0.7 },
    { name: "type", weight: 0.2 },
    { name: "filePath", weight: 0.1 },
  ],
  threshold: 0.3,
  distance: 10,
  includeScore: true,
  minMatchCharLength: 1,
  ignoreLocation: true,
  fieldNormWeight: 1.35,
};

/** Settings/options search: short labels (LobeHub pattern) */
export const SETTINGS_SEARCH_OPTIONS: IFuseOptions<{
  label: string;
  description?: string;
}> = {
  keys: [
    { name: "label", weight: 0.7 },
    { name: "description", weight: 0.3 },
  ],
  threshold: 0.35,
  distance: 100,
  includeScore: true,
  minMatchCharLength: 1,
  ignoreLocation: true,
};

// ─── Fuse Instance Cache (YCS pattern) ──────────────────────────────────────

interface FuseCacheEntry<T> {
  fuse: Fuse<T>;
  dataRef: ReadonlyArray<T>;
  optionsSig: string;
}

const fuseCache = new Map<string, FuseCacheEntry<unknown>>();

function buildOptionsSignature<T>(options: IFuseOptions<T>): string {
  return JSON.stringify({
    keys: options.keys,
    threshold: options.threshold,
    distance: options.distance,
    ignoreLocation: options.ignoreLocation,
    fieldNormWeight: options.fieldNormWeight,
  });
}

/**
 * Get or create a cached Fuse instance. Reuses the instance if the data
 * and options haven't changed (YCS caching pattern).
 */
export function getCachedFuse<T>(
  data: ReadonlyArray<T>,
  options: IFuseOptions<T>,
  cacheKey: string,
): Fuse<T> {
  const optionsSig = buildOptionsSignature(options);
  const cached = fuseCache.get(cacheKey) as FuseCacheEntry<T> | undefined;

  if (cached && cached.dataRef === data && cached.optionsSig === optionsSig) {
    return cached.fuse;
  }

  const fuse = new Fuse(data, options);
  fuseCache.set(cacheKey, {
    fuse: fuse as Fuse<unknown>,
    dataRef: data as ReadonlyArray<unknown>,
    optionsSig,
  });

  // Evict oldest entries if cache grows too large
  if (fuseCache.size > 20) {
    const firstKey = fuseCache.keys().next().value;
    if (firstKey !== undefined) {
      fuseCache.delete(firstKey);
    }
  }

  return fuse;
}

/**
 * Quick fuzzy search — builds index and searches in one call.
 * For one-off searches where caching isn't needed.
 */
export function quickFuzzySearch<T>(
  data: ReadonlyArray<T>,
  query: string,
  options: IFuseOptions<T>,
  limit = 20,
): Array<{ item: T; score: number }> {
  const fuse = new Fuse(data, options);
  const results = fuse.search(query, { limit });
  return results
    .filter((r) => r.score !== undefined)
    .map((r) => ({
      item: r.item,
      score: 1 - (r.score ?? 0), // invert: Fuse 0=best, we want 1=best
    }));
}

/**
 * Clear the Fuse instance cache (call on app shutdown or memory pressure).
 */
export function clearFuseCache(): void {
  fuseCache.clear();
}
