import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRestrictedModels,
  isRestrictedModel,
  listRestrictedModels,
  noteRestrictedModel,
} from "./restricted_model_memory";

describe("restricted_model_memory", () => {
  beforeEach(() => {
    clearRestrictedModels();
    vi.useRealTimers();
  });

  it("skips nothing until a restriction is observed", () => {
    expect(isRestrictedModel("thinkingmachines/inkling-small:free")).toBe(
      false,
    );
    expect(listRestrictedModels()).toEqual([]);
  });

  it("remembers a restricted model for later chain building", () => {
    noteRestrictedModel("thinkingmachines/inkling-small:free");

    expect(isRestrictedModel("thinkingmachines/inkling-small:free")).toBe(true);
    expect(listRestrictedModels()).toEqual([
      "thinkingmachines/inkling-small:free",
    ]);
    expect(isRestrictedModel("openrouter/free")).toBe(false);
  });

  it("ignores empty ids", () => {
    noteRestrictedModel("");

    expect(listRestrictedModels()).toEqual([]);
  });

  it("expires entries after one hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    noteRestrictedModel("thinkingmachines/inkling-small:free");
    expect(isRestrictedModel("thinkingmachines/inkling-small:free")).toBe(true);

    vi.setSystemTime(60 * 60 * 1000 + 1);
    expect(isRestrictedModel("thinkingmachines/inkling-small:free")).toBe(
      false,
    );
    expect(listRestrictedModels()).toEqual([]);
  });
});
