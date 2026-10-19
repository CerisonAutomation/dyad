import { eq } from "drizzle-orm";

import { db } from "@/db";
import { language_models as languageModelsSchema } from "@/db/schema";

export const MAX_CUSTOM_BACKUPS = 5;

/**
 * Order same-provider backup models behind the user's pick. The selected
 * model stays first, restricted ids observed earlier are dropped, and the
 * list is capped so a provider with dozens of registered models cannot
 * stretch one turn into an unbounded walk.
 */
export function orderCustomBackupNames(
  selectedName: string,
  siblingNames: readonly string[],
  restrictedApiNames: readonly string[],
  maxBackups: number = MAX_CUSTOM_BACKUPS,
): string[] {
  const restricted = new Set(restrictedApiNames);
  const backups: string[] = [];
  for (const name of siblingNames) {
    if (name === selectedName) continue;
    if (restricted.has(name)) continue;
    if (!backups.includes(name)) {
      backups.push(name);
    }
    if (backups.length >= maxBackups) break;
  }
  return backups;
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
