import { describe, expect, it } from "vitest";
import { isFreeModel, isFreeModelName, routeFreeModelForProvider } from "@/lib/freeModel";

describe("canonical free-model detection", () => {
  it("treats the catalog price as authoritative", () => {
    // A model priced at zero but without a :free suffix IS free.
    expect(isFreeModel({ apiName: "stealth/space-bunny-alpha", dollarSigns: 0 })).toBe(true);
    expect(isFreeModel({ apiName: "stealth/space-bunny-alpha", dollarSigns: 3 })).toBe(false);
  });

  it("falls back to the id suffix when there is no catalog entry", () => {
    expect(isFreeModel({ apiName: "poolside/laguna-s-2.1:free" })).toBe(true);
    expect(isFreeModel({ apiName: "openrouter/free" })).toBe(true);
    expect(isFreeModel({ apiName: "gpt-4o" })).toBe(false);
  });

  it("never reports a priced model as free because of a suffix", () => {
    expect(isFreeModel({ apiName: "x:free", dollarSigns: 2 })).toBe(false);
  });

  it("handles missing input", () => {
    expect(isFreeModel({})).toBe(false);
    expect(isFreeModelName(undefined)).toBe(false);
  });

  it("routes only kilocode free models through the router", () => {
    const m = { provider: "kilocode", name: "poolside/laguna-s-2.1:free" };
    expect(routeFreeModelForProvider(m).name).toBe("kilo-auto/free");
    expect(routeFreeModelForProvider({ ...m, provider: "openrouter" }).name).toBe(
      "poolside/laguna-s-2.1:free",
    );
    expect(routeFreeModelForProvider({ ...m, name: "kilo-auto/free" }).name).toBe(
      "kilo-auto/free",
    );
  });
});
