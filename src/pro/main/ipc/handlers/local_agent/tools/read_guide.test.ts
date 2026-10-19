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
});
