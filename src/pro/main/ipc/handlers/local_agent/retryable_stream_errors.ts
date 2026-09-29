/**
 * Shared transient-stream classification for every model-calling path.
 *
 * The main agent and the sub-agents stream through separate code, and both
 * need the same treatment: a gateway that intermittently returns an empty
 * completion must be retried rather than ending the turn. This lives in its own
 * dependency-free module because the two callers import each other - putting
 * the classifier in either one would create a cycle, and a cycle is how the
 * previously duplicated logic drifted apart in the first place.
 */

export const RETRYABLE_STREAM_ERROR_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504,
]);

export const RETRYABLE_STREAM_ERROR_PATTERNS = [
  "server_error",
  "internal server error",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "too many requests",
  "rate_limit",
  "overloaded",
  "econnrefused",
  "enotfound",
  "econnreset",
  "epipe",
  "etimedout",
  // Gateways (Kilo, OpenRouter, and others) intermittently return a completed
  // turn whose content is empty - either because the upstream model emitted only
  // reasoning and hit its output cap, or because the gateway dropped the
  // response. The message text comes from the provider, not from this app, and it
  // arrives with no usable token usage, so nothing downstream can tell it apart
  // from a hard failure. It is transient: the same request normally succeeds on
  // a retry, so no agent should stop on it.
  "empty response",
  "returned an empty",
  "empty_response",
  "no content",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function unwrapStreamError(error: unknown): unknown {
  if (isRecord(error) && "error" in error) {
    return error.error;
  }
  return error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    if (typeof error.message === "string" && error.message.length > 0) {
      return error.message;
    }
    if ("error" in error) {
      return getErrorMessage(error.error);
    }
    if ("cause" in error) {
      return getErrorMessage(error.cause);
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function matchesRetryableText(text: string): boolean {
  const lower = text.toLowerCase();
  return RETRYABLE_STREAM_ERROR_PATTERNS.some((pattern) =>
    lower.includes(pattern),
  );
}

export function isTerminatedStreamError(error: unknown): boolean {
  const normalized = unwrapStreamError(error);
  const message = getErrorMessage(normalized).toLowerCase();
  if (message.includes("typeerror: terminated") || message === "terminated") {
    return true;
  }
  const cause =
    isRecord(normalized) && "cause" in normalized ? normalized.cause : undefined;
  if (cause) {
    return isTerminatedStreamError(cause);
  }
  return false;
}

export function isRetryableProviderStreamError(error: unknown): boolean {
  const normalized = unwrapStreamError(error);
  if (!isRecord(normalized)) {
    // The AI SDK can hand a stream failure over as a bare string rather than an
    // Error - getErrorMessage renders those without a "Name: " prefix, which is
    // how this showed up in the logs. A string carries no statusCode or code, so
    // bailing out here classified every one of them as non-retryable and ended
    // the run. Match on the text instead.
    return matchesRetryableText(
      typeof normalized === "string"
        ? normalized
        : getErrorMessage(normalized),
    );
  }

  const statusCode =
    (typeof normalized.statusCode === "number" && normalized.statusCode) ||
    (isRecord(normalized.response) &&
      typeof normalized.response.status === "number" &&
      normalized.response.status) ||
    undefined;

  if (
    typeof statusCode === "number" &&
    (statusCode >= 500 || RETRYABLE_STREAM_ERROR_STATUS_CODES.has(statusCode))
  ) {
    return true;
  }

  return matchesRetryableText(
    [
      typeof normalized.message === "string" ? normalized.message : undefined,
      typeof normalized.code === "string" ? normalized.code : undefined,
      typeof normalized.type === "string" ? normalized.type : undefined,
    ]
      .filter(Boolean)
      .join(" ") || getErrorMessage(normalized),
  );
}
