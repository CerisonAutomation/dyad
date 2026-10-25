import { describe, expect, it } from "vitest";
import { searchLocalCode } from "./local_code_search";
describe("local code retrieval", () => {
  const files = [
    {
      path: "src/auth/middleware.ts",
      content: "export function authenticateRequest() { return true; }",
    },
    { path: "src/cart.ts", content: "export const checkout = 1;" },
    { path: ".env.production", content: "authenticateRequest secret" },
  ];
  it("ranks paths and symbols without a server", () => {
    expect(searchLocalCode("auth middleware", files).results[0].path).toBe(
      "src/auth/middleware.ts",
    );
  });
  it("tolerates a misspelled symbol", () => {
    expect(searchLocalCode("authentcateRequest", files).results[0].path).toBe(
      "src/auth/middleware.ts",
    );
  });
  it("excludes credential paths", () => {
    expect(searchLocalCode("secret", files).results).toEqual([]);
  });
  it("is deterministic and handles punctuation/empty queries", () => {
    expect(searchLocalCode("!!!", files).results).toEqual([]);
    expect(searchLocalCode("export", files).results).toEqual(
      searchLocalCode("export", [...files].reverse()).results,
    );
  });
  it("reports truncated content instead of claiming exhaustive coverage", () => {
    expect(
      searchLocalCode("end", [
        { path: "huge.ts", content: "x".repeat(110000) + "end" },
      ]).truncated,
    ).toBe(true);
  });
});
