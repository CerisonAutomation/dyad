import { expect, it } from "vitest";
import { isBasicAgentMode, type UserSettings } from "./schemas";
import {
  getAuxiliarySettings,
  getAuxiliaryModel,
  hasProviderAgentSelection,
} from "./auxiliaryModel";

it.each(["anthropic", "google", "ollama", "custom"])(
  "preserves BYO %s helper billing without mutating main-chat settings",
  (provider) => {
    const settings = {
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      proModelUsage: "api-key",
      selectedModel: { provider, name: "chosen", connection: "api-key" },
    } as unknown as UserSettings;
    expect(getAuxiliarySettings(settings)).toBe(settings);
    expect(settings.proModelUsage).toBe("api-key");
  },
);
it.each(["pro", "subscription", undefined] as const)(
  "preserves existing helper routing for source %s",
  (proModelUsage) => {
    const settings = { proModelUsage } as unknown as UserSettings;
    expect(getAuxiliarySettings(settings)).toBe(settings);
  },
);
it.each([false, true])(
  "does not enable engine billing without Pro access (toggle %s)",
  (enableDyadPro) => {
    const settings = {
      proModelUsage: "api-key",
      enableDyadPro,
      providerSettings: {},
    } as unknown as UserSettings;
    expect(getAuxiliarySettings(settings)).toBe(settings);
  },
);
it("preserves free BYO with a saved Pro key when Pro is off", () => {
  const settings = {
    proModelUsage: "api-key",
    enableDyadPro: false,
    providerSettings: { auto: { apiKey: { value: "pro-key" } } },
  } as unknown as UserSettings;
  expect(getAuxiliarySettings(settings)).toBe(settings);
});

it.each(["api-key", "subscription"] as const)(
  "inherits the selected model in %s mode",
  (proModelUsage) => {
    const selectedModel = {
      provider: "openai",
      name: "chosen",
      connection: "subscription" as const,
      effortLevel: "high",
    };
    const settings = {
      proModelUsage,
      selectedModel,
    } as unknown as UserSettings;
    expect(getAuxiliaryModel(settings)).toEqual({
      ...selectedModel,
      connection: proModelUsage === "api-key" ? "api-key" : "subscription",
    });
  },
);

it.each(["api-key", "subscription"] as const)(
  "enables provider agent capability without Pro for %s",
  (proModelUsage) => {
    expect(
      hasProviderAgentSelection({
        proModelUsage,
        selectedModel: { provider: "openai", name: "chosen" },
      } as UserSettings),
    ).toBe(true);
    expect(
      hasProviderAgentSelection({
        proModelUsage,
        selectedModel: { provider: "auto", name: "value" },
      } as UserSettings),
    ).toBe(false);
  },
);

it.each(["api-key", "subscription"] as const)(
  "does not consume Dyad free quota for explicit %s agent inference",
  (proModelUsage) => {
    expect(
      isBasicAgentMode({
        proModelUsage,
        selectedModel: { provider: "openai", name: "chosen" },
        selectedChatMode: "local-agent",
        enableDyadPro: false,
      } as UserSettings),
    ).toBe(false);
  },
);

it.each(["openai", "anthropic", "google", "ollama", "custom::team"])(
  "automatic helpers honor the selected %s model instead of a hardcoded default",
  (provider) => {
    const selectedModel = { provider, name: "chosen", effortLevel: "high" };
    const settings = { selectedModel } as unknown as UserSettings;
    expect(getAuxiliaryModel(settings)).toEqual(selectedModel);
    expect(hasProviderAgentSelection(settings)).toBe(true);
    expect(
      isBasicAgentMode({
        ...settings,
        selectedChatMode: "local-agent",
        enableDyadPro: false,
      }),
    ).toBe(false);
  },
);
it("preserves an explicit account connection in automatic helper routing", () => {
  const selectedModel = {
    provider: "openai",
    name: "chosen",
    connection: "subscription" as const,
  };
  expect(getAuxiliaryModel({ selectedModel } as UserSettings)).toEqual(
    selectedModel,
  );
});
it("rejects obsolete paid sources rather than silently changing billing", () => {
  const selectedModel = {
    provider: "openai",
    name: "chosen",
    connection: "pro" as const,
  };
  expect(() => getAuxiliaryModel({ selectedModel } as UserSettings)).toThrow(
    "Legacy application credits",
  );
  expect(hasProviderAgentSelection({ selectedModel })).toBe(false);
  expect(() =>
    getAuxiliaryModel({ selectedModel, proModelUsage: "pro" } as UserSettings),
  ).toThrow();
});
it("does not substitute a hardcoded helper when selection is missing", () => {
  expect(() => getAuxiliaryModel({} as UserSettings)).toThrow("Select a model");
});

it("does not advertise provider agent capability without a model name", () => {
  expect(
    hasProviderAgentSelection({
      selectedModel: { provider: "openai", name: "" },
    }),
  ).toBe(false);
});
