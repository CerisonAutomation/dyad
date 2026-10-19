import { describe, expect, it } from "vitest";

import { readGuideTool } from "./read_guide";
import type { AgentContext } from "./types";

const ctx = (frameworkType: AgentContext["frameworkType"]) =>
  ({ frameworkType }) as unknown as AgentContext;

describe("readGuideTool", () => {
  it("serves framework-agnostic replica guides untouched", async () => {
    const out = await readGuideTool.execute(
      { guide: "replica-recon" },
      ctx(null),
    );

    expect(out).toContain("# replica-recon");
    expect(out).toContain("replica/recon.md");
  });

  it("rejects unknown guides while listing the replica set", async () => {
    await expect(
      readGuideTool.execute({ guide: "no-such-guide" }, ctx(null)),
    ).rejects.toThrow(/replica-recon/);
  });

  it("serves the QA skill ports untouched", async () => {
    for (const guide of [
      "qa-e2e-testing",
      "qa-ai-regression-testing",
      "qa-agent-introspection-debugging",
      "qa-security-review",
    ]) {
      const out = await readGuideTool.execute({ guide }, ctx(null));
      expect(out).toContain("Ported from affaan-m/ECC skills");
    }
  });
});
