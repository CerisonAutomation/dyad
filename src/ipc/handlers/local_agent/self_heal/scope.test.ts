import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertSelfHealScope } from "./scope";

const root = path.resolve(os.tmpdir(), "dyad-repo");

describe("assertSelfHealScope", () => {
  it("allows a path inside the Dyad repository", () => {
    expect(() =>
      assertSelfHealScope(
        root,
        "src/ipc/handlers/local_agent/self_heal/index.ts",
      ),
    ).not.toThrow();
  });

  it("allows an absolute path inside the Dyad repository", () => {
    expect(() =>
      assertSelfHealScope(root, path.join(root, "src", "index.ts")),
    ).not.toThrow();
  });

  it("rejects a path outside the Dyad repository", () => {
    expect(() => assertSelfHealScope(root, "../../etc/passwd")).toThrow(
      DyadError,
    );
  });

  it("rejects an absolute path outside the Dyad repository", () => {
    expect(() => assertSelfHealScope(root, "/etc/passwd")).toThrow(DyadError);
  });

  it("rejects a sibling directory with a shared prefix", () => {
    expect(() =>
      assertSelfHealScope(root, path.resolve(`${root}-other`, "file.ts")),
    ).toThrow(DyadError);
  });

  it("rejects the repository root itself", () => {
    expect(() => assertSelfHealScope(root, root)).toThrow(DyadError);
  });

  it("rejects an empty target", () => {
    expect(() => assertSelfHealScope(root, "  ")).toThrow(DyadError);
  });

  it("rejects a missing repository root", () => {
    expect(() => assertSelfHealScope("", "src/index.ts")).toThrow(DyadError);
  });

  it("throws a validation error", () => {
    try {
      assertSelfHealScope(root, "/etc/passwd");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DyadError);
      expect((error as DyadError).kind).toBe(DyadErrorKind.Validation);
    }
  });
});
