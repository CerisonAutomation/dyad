import type { UserSettings } from "./schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Auxiliary features must never resurrect an old Pro key or billing source. */
export function providerOnlyInferenceSettings(
  settings: UserSettings,
): UserSettings {
  if (settings.proModelUsage === "pro")
    throw new DyadError(
      "Select API keys or a connected Claude/ChatGPT subscription in the model picker. Dyad credits are not used by this feature.",
      DyadErrorKind.Precondition,
    );
  return { ...settings, enableDyadPro: false };
}
