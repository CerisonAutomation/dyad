import { expect, it } from "vitest";
import type { UserSettings } from "./schemas";
import { providerOnlyInferenceSettings } from "./providerOnlyInference";
it.each(["api-key", "subscription", undefined] as const)(
  "keeps %s source while disabling legacy engine inference",
  (proModelUsage) => {
    const settings = {
      enableDyadPro: true,
      proModelUsage,
      selectedModel: { provider: "openai", name: "selected" },
    } as UserSettings;
    expect(providerOnlyInferenceSettings(settings)).toMatchObject({
      enableDyadPro: false,
      selectedModel: settings.selectedModel,
      proModelUsage,
    });
    expect(settings.enableDyadPro).toBe(true);
  },
);
it("does not silently charge an API key when Pro credits were selected", () => {
  expect(() =>
    providerOnlyInferenceSettings({ proModelUsage: "pro" } as UserSettings),
  ).toThrow("Select API keys");
});
