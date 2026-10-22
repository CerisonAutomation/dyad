/**
 * Recovery from a stale dev-server chunk.
 *
 * A dev-server restart (or an HMR invalidation) can leave the preview holding
 * a hashed chunk path the server no longer serves. The browser then fails to
 * import that module, the whole preview dies, and the user is left with an
 * error banner and a manual restart.
 *
 * The preview can recover from that on its own: reloading the iframe asks the
 * dev server for the document again, and the new build serves the chunks it
 * knows about. This module owns the classification of that failure and the
 * bounds on the recovery that follows it.
 *
 * Machine dependency graph: preview_iframe -> none.
 */

/** How many automatic reloads one preview may spend on a stale chunk. */
export const CHUNK_RECOVERY_MAX_ATTEMPTS = 2;

/**
 * How long to wait before reloading. A dev server that is still coming back
 * would answer the reload with an error page, so the recovery gives it a
 * moment first.
 */
export const CHUNK_RECOVERY_DELAY_MS = 1_500;

const STALE_CHUNK_PATTERNS: readonly RegExp[] = [
  // Chromium: "Failed to fetch dynamically imported module: <url>"
  /failed to fetch dynamically imported module/i,
  // Firefox: "error loading dynamically imported module: <url>"
  /error loading dynamically imported module/i,
  // Safari: "Importing a module script failed."
  /importing a module script failed/i,
  // webpack: "ChunkLoadError: Loading chunk 3 failed."
  /chunkloaderror/i,
  /loading chunk [\w.-]+ failed/i,
];

/**
 * Whether the error is a module the browser could not load — the shape a
 * stale dev-server chunk takes once the server has moved on from it.
 */
export function isStaleChunkErrorMessage(message: string): boolean {
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}
