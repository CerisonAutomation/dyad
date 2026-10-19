import { eq } from "drizzle-orm";

import { db } from "@/db";
import { language_models as languageModelsSchema } from "@/db/schema";

export const MAX_CUSTOM_BACKUPS = 5;

/**
 * Order same-provider backup models behind the user's pick. The selected
 * model is excluded (it leads the chain), restricted ids are dropped, and
 * the rest sort by proven recency: models that served recently come first
 * while never-tried models keep registration order (stable sort). Capped so
 * one provider cannot stretch a turn into an unbounded walk.
 */
export function orderCustomBackupNames(
  selectedName: string,
  siblingNames: readonly string[],
  restrictedApiNames: readonly string[],
  lastSuccessAt: ReadonlyMap<string, number> = new Map(),
  maxBackups: number = MAX_CUSTOM_BACKUPS,
): string[] {
  const restricted = new Set(restrictedApiNames);
  const candidates: string[] = [];
  for (const name of siblingNames) {
    if (name === selectedName) continue;
    if (restricted.has(name)) continue;
    if (!candidates.includes(name)) {
      candidates.push(name);
    }
  }
  candidates.sort(
    (a, b) => (lastSuccessAt.get(b) ?? 0) - (lastSuccessAt.get(a) ?? 0),
  );
  return candidates.slice(0, maxBackups);
}

/**
 * Names of the models registered on one custom provider, read live so added
 * and removed models take effect without an app restart. Synchronous:
 * better-sqlite3 executes inline. Throws when the database cannot be read;
 * callers treat that as "no backups" and run the selected model alone.
 */
export function listCustomProviderModelNames(
  customProviderId: string,
): string[] {
  const rows = db
    .select({ apiName: languageModelsSchema.apiName })
    .from(languageModelsSchema)
    .where(eq(languageModelsSchema.customProviderId, customProviderId))
    .all();
  return rows.map((row) => row.apiName);
}
