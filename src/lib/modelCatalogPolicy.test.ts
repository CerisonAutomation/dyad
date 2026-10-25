import { describe, expect, it } from "vitest";
import { isFreeCatalogModel, rankModelCatalog } from "./modelCatalogPolicy";
const model = (apiName: string, extra = {}) => ({
  apiName,
  displayName: apiName,
  ...extra,
});
describe("free-first catalog policy", () => {
  it("moves free rows first without treating unknown costs or free-tier providers as free", () => {
    const input = {
      openrouter: [
        model("paid", { dollarSigns: 2 }),
        model("unknown"),
        model("x:free"),
        model("paid2", { dollarSigns: 1 }),
      ],
    };
    expect(rankModelCatalog(input).openrouter.map((m) => m.apiName)).toEqual([
      "x:free",
      "paid2",
      "paid",
      "unknown",
    ]);
    expect(input.openrouter[0].apiName).toBe("paid");
    expect(
      isFreeCatalogModel("google", model("x:free", { dollarSigns: 0 })),
    ).toBe(false);
  });
  it("honors explicit provider pricing over model name", () => {
    expect(
      isFreeCatalogModel("openrouter", model("x:free", { isFree: false })),
    ).toBe(false);
    expect(
      isFreeCatalogModel("openrouter", model("new", { isFree: true })),
    ).toBe(true);
  });
  it("preserves stable equal/unknown ordering", () => {
    expect(
      rankModelCatalog({ test: [model("b"), model("a")] }).test.map(
        (m) => m.apiName,
      ),
    ).toEqual(["b", "a"]);
  });
});

import { freeAutoCandidates } from "./modelCatalogPolicy";
it("Auto Free uses tool-capable free models only, deduplicates and stays bounded", () => {
  const rows = [
    model("paid", { isFree: false, supportsTools: true }),
    model("text:free", { isFree: true, supportsTools: false }),
    model("custom:free", { type: "custom", supportsTools: true }),
    ...Array.from({ length: 20 }, (_, i) =>
      model(`m${i}:free`, { supportsTools: true, contextWindow: i + 1 }),
    ),
  ];
  const names = freeAutoCandidates(rows, [
    "openrouter/free",
    "openrouter/free",
  ]);
  expect(names).toHaveLength(7);
  expect(names[0]).toBe("m19:free");
  expect(names).not.toContain("paid");
  expect(names).not.toContain("text:free");
  expect(names).not.toContain("custom:free");
});
it("never revives a builtin free fallback contradicted by current provider pricing", () => {
  expect(freeAutoCandidates([model("x:free", { isFree: false, supportsTools: true })], ["x:free", "paid"])).toEqual([]);
});
