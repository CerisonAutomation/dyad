import { isAgent2Enabled, type UserSettings } from "./schemas";

/** Pro helpers retain their engine models even when main-chat inference uses BYO.
 * Return a request-only snapshot; never change the user's billing-source setting.
 */
export function getAuxiliarySettings(settings: UserSettings): UserSettings {
  return settings.proModelUsage === "api-key" && isAgent2Enabled(settings)
    ? { ...settings, proModelUsage: "pro" }
    : settings;
}
