/**
 * Retired application-billing surface. Kept as a no-op for older extensions
 * and test harnesses; provider account status is handled by provider settings.
 * Do not fetch hosted billing status or send billing-nudge telemetry here.
 */
export function SubscriptionStatusBanner() {
  return null;
}
