/**
 * Session memory of model ids that a gateway allowlist rejected.
 *
 * Some gateways restrict individual free models to approved harnesses
 * ("... is only available on agentic harnesses"). Retrying such a model can
 * never succeed, in this turn or the next, so once observed the id is
 * skipped while building later chains. Entries expire after one hour; a
 * model removed from an allowlist becomes eligible again on its own.
 * Process-local and in-memory only: nothing leaves the machine.
 */

const RESTRICTED_TTL_MS = 60 * 60 * 1000;

const restrictedSince = new Map<string, number>();

export function noteRestrictedModel(apiName: string): void {
  if (apiName.length > 0) {
    restrictedSince.set(apiName, Date.now());
  }
}

export function isRestrictedModel(apiName: string): boolean {
  const notedAt = restrictedSince.get(apiName);
  if (notedAt === undefined) return false;
  if (Date.now() - notedAt > RESTRICTED_TTL_MS) {
    restrictedSince.delete(apiName);
    return false;
  }
  return true;
}

export function listRestrictedModels(): string[] {
  const now = Date.now();
  const live: string[] = [];
  for (const [apiName, notedAt] of restrictedSince) {
    if (now - notedAt > RESTRICTED_TTL_MS) {
      restrictedSince.delete(apiName);
    } else {
      live.push(apiName);
    }
  }
  return live;
}

export function clearRestrictedModels(): void {
  restrictedSince.clear();
}
