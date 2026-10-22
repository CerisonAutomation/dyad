import { describe, expect, it } from "vitest";

import {
  buildArchitectDesignerPrompt,
  composePersonaPrompt,
  CAVEMAN_BLOCK,
  HEADROOM_BLOCK,
} from "./prompts";
import type { PreventionRule } from "./types";

const rule: PreventionRule = {
  id: "resolve-app-relative-paths",
  title: "Resolve app-relative paths",
  rule: "List the directory and re-resolve; never repeat the same path.",
  createdAt: 1,
  sourceSignature: "read_file|not_found|path:.ts|<path>",
  occurrences: 3,
};

describe("composePersonaPrompt", () => {
  it("returns the base prompt unchanged when no block is requested", () => {
    expect(composePersonaPrompt("BASE")).toBe("BASE");
  });

  it("injects the caveman and headroom blocks", () => {
    const composed = composePersonaPrompt("BASE", {
      caveman: true,
      headroom: true,
    });
    expect(composed).toContain(CAVEMAN_BLOCK);
    expect(composed).toContain(HEADROOM_BLOCK);
    expect(composed).toContain("BASE");
    expect(composed.indexOf(CAVEMAN_BLOCK)).toBeLessThan(
      composed.indexOf("BASE"),
    );
  });

  it("injects only the requested block", () => {
    const composed = composePersonaPrompt("BASE", { headroom: true });
    expect(composed).toContain(HEADROOM_BLOCK);
    expect(composed).not.toContain(CAVEMAN_BLOCK);
  });
});

describe("buildArchitectDesignerPrompt", () => {
  it("states the scope, the oracle rule and the prevention rules", () => {
    const prompt = buildArchitectDesignerPrompt({
      appPath: "/repo/dyad",
      preventionRules: [rule],
    });
    expect(prompt).toContain("/repo/dyad");
    expect(prompt).toContain("at least 2 of the 3 oracles agree");
    expect(prompt).toContain("Resolve app-relative paths");
    expect(prompt).toContain("never repeat the same path");
    expect(prompt).toContain("5 iterations");
  });

  it("says so when there are no prevention rules", () => {
    const prompt = buildArchitectDesignerPrompt({
      appPath: "/repo/dyad",
      preventionRules: [],
    });
    expect(prompt).toContain("No prevention rules yet");
  });

  it("allows the shared blocks to be switched off", () => {
    const prompt = buildArchitectDesignerPrompt({
      appPath: "/repo/dyad",
      preventionRules: [],
      caveman: false,
      headroom: false,
    });
    expect(prompt).not.toContain(CAVEMAN_BLOCK);
    expect(prompt).not.toContain(HEADROOM_BLOCK);
  });
});
