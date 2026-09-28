/**
 * Canonical "is this model free?" test.
 *
 * This existed as two ad-hoc copies in ModelPicker (`isKiloFreeModel` and
 * `isFreeOpenRouterModelName`, byte-identical) plus a separate `dollarSigns ===
 * 0` check for the price badge. They disagreed: the catalog prices 49 models
 * at zero, but only 34 carry a `:free` / `/free` id suffix, so the Free
 * filter was hiding 15 genuinely free models — and pricing is the field the
 * badge and the picker already render from.
 *
 * Price is therefore authoritative. The id-suffix test is kept only as a
 * fallback for a model with no catalog entry, because every current free id
 * does use one of those suffixes.
 */
export function isFreeModelName(apiName: string | undefined): boolean {
  if (!apiName) return false;
  return apiName.endsWith(":free") || apiName.endsWith("/free");
}

/**
 * @param dollarSigns price tier from the catalog; 0 means free. Undefined when
 *                   the model has no catalog entry, in which case the id
 *                   suffix decides.
 */
export function isFreeModel(input: {
  apiName?: string;
  dollarSigns?: number | null;
}): boolean {
  if (typeof input.dollarSigns === "number") {
    return input.dollarSigns === 0;
  }
  return isFreeModelName(input.apiName);
}

/**
 * Kilo rate-limits direct `:free` requests but serves the same models through
 * its `kilo-auto/free` router, which retries and falls back. Measured on one
 * key: `poolside/laguna-s-2.1:free` -> 429, while `kilo-auto/free` -> 200
 * routing to that same model. So direct free picks are sent via the router,
 * while the model the user picked is what gets displayed and stored.
 */
export const KILO_FREE_ROUTER = "kilo-auto/free";

export function routeFreeModelForProvider<T extends { provider: string; name: string }>(
  model: T,
): T {
  if (model.provider !== "kilocode") return model;
  if (model.name === KILO_FREE_ROUTER) return model;
  if (!isFreeModelName(model.name)) return model;
  return { ...model, name: KILO_FREE_ROUTER };
}
