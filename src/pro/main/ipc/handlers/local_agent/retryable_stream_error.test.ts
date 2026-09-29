import { describe, expect, test } from "vitest";
import { isRetryableProviderStreamError } from "./local_agent_handler";

// Gateways return this text verbatim; it is not produced anywhere in this app.
const EMPTY_RESPONSE = "Provider returned an empty response";

describe("isRetryableProviderStreamError", () => {
  test("treats a gateway empty response as retryable", () => {
    // Regression: this escaped the retry classifier, so a transient empty
    // completion ended the whole agent run instead of retrying.
    expect(isRetryableProviderStreamError(new Error(EMPTY_RESPONSE))).toBe(true);
  });

  test("matches the empty response through the SDK error wrapper shape", () => {
    // The SDK wraps provider failures; the classifier falls back to
    // getErrorMessage, which recurses into `error`, so the wrapped form is
    // classified too.
    expect(
      isRetryableProviderStreamError({
        error: new Error(EMPTY_RESPONSE),
      }),
    ).toBe(true);
  });

  test("matches related transient phrasings", () => {
    for (const message of [
      "Gateway returned an empty response",
      "empty_response from upstream",
      EMPTY_RESPONSE.toUpperCase(),
    ]) {
      expect(isRetryableProviderStreamError(new Error(message))).toBe(true);
    }
  });

  test("still matches the pre-existing retryable classes", () => {
    for (const message of [
      "internal server error",
      "rate_limit exceeded",
      "ECONNRESET",
    ]) {
      expect(isRetryableProviderStreamError(new Error(message))).toBe(true);
    }
  });

  test("matches when the SDK delivers a bare string rather than an Error", () => {
    // Regression: the AI SDK hands some stream failures over as a plain string.
    // getErrorMessage renders those with no "Name: " prefix, and the classifier
    // used to return false for anything that was not a record - so every
    // bare-string failure was treated as fatal and the agent stopped.
    expect(isRetryableProviderStreamError(EMPTY_RESPONSE)).toBe(true);
    expect(isRetryableProviderStreamError("ECONNRESET")).toBe(true);
    expect(isRetryableProviderStreamError("tool call arguments invalid")).toBe(
      false,
    );
  });

  test("does not retry an ordinary model failure", () => {
    expect(
      isRetryableProviderStreamError(new Error("Tool call arguments invalid")),
    ).toBe(false);
  });
});
