/**
 * Free-model identification shared by OpenCode gateway discovery and the
 * fallback chain. A model id counts as free when it carries the gateway's
 * free suffix (`:free` for OpenRouter-style ids, `-free` for Go ids like
 * `longcat-2.5-preview-free`) or is the `openrouter/free` router itself.
 */
const FREE_ID_PATTERN = /(:free|(\b|-)free)$/;

export function isFreeModelName(apiName: string | null | undefined): boolean {
  if (!apiName) return false;
  if (apiName === "openrouter/free") return true;
  return FREE_ID_PATTERN.test(apiName);
}
