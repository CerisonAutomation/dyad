/**
 * Retry budget for model requests.
 *
 * The AI SDK's `maxRetries` option is the number of RETRIES it performs
 * *after* the first attempt, so the total attempt count is `maxRetries + 1`.
 *
 * Upstream gateways (and the Dyad Engine) intermittently answer with
 * "Upstream request failed" / "Endpoint is unavailable", so a single retry
 * helps ride out a short outage.
 *
 * The budget must stay SMALL, though: the SDK backs off exponentially
 * (2s, 4s, 8s, ...), so every extra retry adds minutes of silent waiting to
 * a single request. A turn has no request-level timeout, so a large retry
 * budget lets one failing request hang the whole turn for many minutes
 * instead of failing fast and letting the model try a different approach.
 * Three retries (four total attempts) keep the worst-case backoff at
 * 2s + 4s + 8s = 14s, which still covers a brief gateway blip.
 *
 * This lives in its own dependency-free module so it can be asserted in a
 * unit test without pulling in the whole local-agent handler.
 */

/** Number of retries the AI SDK performs after the first attempt. */
export const AI_SDK_MAX_RETRIES = 3;

/** Total number of attempts the AI SDK makes, including the first one. */
export const AI_SDK_MAX_ATTEMPTS = AI_SDK_MAX_RETRIES + 1;

/**
 * Worst-case time the SDK spends sleeping between attempts, in milliseconds.
 * The SDK doubles the delay per attempt, starting at 2 seconds.
 */
export const AI_SDK_MAX_BACKOFF_MS = (2 ** AI_SDK_MAX_RETRIES - 1) * 2000;
