import type { LanguageModel } from "@/ipc/types/language-model";

/** A provider free tier is not proof that an individual model is free. */
export function isFreeCatalogModel(
  providerId: string,
  model: LanguageModel,
): boolean {
  if (typeof model.isFree === "boolean") return model.isFree;
  return (
    providerId === "openrouter" &&
    (model.apiName.endsWith(":free") || model.apiName === "openrouter/free")
  );
}

export function compareCatalogModels(
  providerId: string,
  a: LanguageModel,
  b: LanguageModel,
): number {
  const free =
    Number(isFreeCatalogModel(providerId, b)) -
    Number(isFreeCatalogModel(providerId, a));
  if (free) return free;
  // Unknown price is not zero. Stable ties preserve provider/catalog ordering.
  return (a.dollarSigns ?? Infinity) - (b.dollarSigns ?? Infinity) || 0;
}

export function rankModelCatalog(
  catalog: Record<string, LanguageModel[]>,
): Record<string, LanguageModel[]> {
  return Object.fromEntries(
    Object.entries(catalog).map(([provider, models]) => [
      provider,
      [...models].sort((a, b) => compareCatalogModels(provider, a, b)),
    ]),
  );
}

/** Only explicit Auto Free uses this; manual model/provider selections never change. */
export function freeAutoCandidates(
  models: LanguageModel[],
  fallback: readonly string[],
): string[] {
  const discovered = models
    .filter(
      (model) =>
        model.type !== "custom" &&
        isFreeCatalogModel("openrouter", model) &&
        (model.supportsTools === true || model.apiName === "openrouter/free"),
    )
    .sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))
    .map((model) => model.apiName);
  const safeFallback = fallback.filter((name) => {
    const row = models.find((model) => model.apiName === name);
    return (
      isFreeCatalogModel(
        "openrouter",
        row ?? { apiName: name, displayName: name },
      ) && row?.supportsTools !== false
    );
  });
  return [...new Set([...discovered.slice(0, 6), ...safeFallback])].slice(0, 8);
}
