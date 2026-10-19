import { describe, expect, it } from "vitest";

import {
  MAX_CUSTOM_BACKUPS,
  listCustomProviderModelNames,
  orderCustomBackupNames,
} from "./custom_provider_backup";

describe("orderCustomBackupNames", () => {
  it("keeps the selected model first by excluding it from backups", () => {
    expect(
      orderCustomBackupNames("longcat", ["longcat", "beam", "bunny"], []),
    ).toEqual(["beam", "bunny"]);
  });

  it("drops restricted ids observed earlier", () => {
    expect(
      orderCustomBackupNames(
        "longcat",
        ["beam", "inkling-small:free", "bunny"],
        ["inkling-small:free"],
      ),
    ).toEqual(["beam", "bunny"]);
  });

  it("returns empty when the provider has a single registered model", () => {
    expect(orderCustomBackupNames("longcat", ["longcat"], [])).toEqual([]);
    expect(orderCustomBackupNames("longcat", [], [])).toEqual([]);
  });

  it("dedupes and caps the backup list", () => {
    const siblings = ["a", "b", "a", "c", "d", "e", "f", "g"];
    const backups = orderCustomBackupNames("primary", siblings, []);

    expect(backups).toEqual(["a", "b", "c", "d", "e"]);
    expect(backups.length).toBeLessThanOrEqual(MAX_CUSTOM_BACKUPS);
  });
});

describe("listCustomProviderModelNames", () => {
  it("throws without an initialized database so callers run solo", () => {
    expect(() => listCustomProviderModelNames("custom::opencode")).toThrow();
  });
});
