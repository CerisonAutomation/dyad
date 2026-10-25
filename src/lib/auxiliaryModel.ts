import type { LargeLanguageModel, UserSettings } from "./schemas";

/** Helpers inherit the accepted inference source; never silently enable Pro. */
export function getAuxiliarySettings(settings: UserSettings): UserSettings {
  return settings;
}

/** Keep provider, connection and effort from the accepted root selection. */
export function getAuxiliaryModel(
  settings: UserSettings,
): LargeLanguageModel & { effortLevel?: string } {
  if (
    settings.proModelUsage === "pro" ||
    (!settings.proModelUsage && settings.selectedModel?.connection === "pro")
  ) {
    throw new Error(
      "Legacy application credits are unsupported. Choose Automatic, API keys or a provider account.",
    );
  }
  if (!settings.selectedModel?.provider || !settings.selectedModel.name) {
    throw new Error("Select a model before using helper inference.");
  }
  if (settings.proModelUsage === "api-key") {
    return { ...settings.selectedModel, connection: "api-key" };
  }
  if (settings.proModelUsage === "subscription") {
    return {
      ...settings.selectedModel,
      connection:
        settings.selectedModel.connection === "subscription"
          ? "subscription"
          : undefined,
    };
  }
  return { ...settings.selectedModel };
}

/** Offering native agent tools is separate from the Dyad paid entitlement.
 * Provider credentials/model capability are validated by the inference client.
 */
export function hasProviderAgentSelection(settings?: {
  proModelUsage?: UserSettings["proModelUsage"];
  selectedModel?: UserSettings["selectedModel"];
}): boolean {
  return Boolean(
    settings &&
    (settings.proModelUsage === "api-key" ||
      settings.proModelUsage === "subscription" ||
      (!settings.proModelUsage &&
        settings.selectedModel?.connection !== "pro")) &&
    settings.selectedModel?.provider &&
    settings.selectedModel.name &&
    settings.selectedModel.provider !== "auto",
  );
}
