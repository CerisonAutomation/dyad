import { describe, expect, it } from "vitest";

import { readGuideTool } from "./read_guide";
import type { AgentContext } from "./types";

const ctx = (frameworkType: AgentContext["frameworkType"]) =>
  ({ frameworkType }) as unknown as AgentContext;

describe("readGuideTool", () => {
  it("serves the preview-control guide with its MCP routing", async () => {
    const out = await readGuideTool.execute(
      { guide: "qa-preview-control" },
      ctx(null),
    );

    expect(out).toContain("# Preview Control");
    expect(out).toContain("preview_snapshot");
  });

  it("rejects unknown guides while listing available guides", async () => {
    await expect(
      readGuideTool.execute({ guide: "no-such-guide" }, ctx(null)),
    ).rejects.toThrow(/qa-preview-control/);
  });
});
