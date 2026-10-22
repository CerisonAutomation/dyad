import { describe, expect, it } from "vitest";
import {
  buildPersonaStyleBlocks,
  CAVEMAN_BLOCK,
  HEADROOM_BLOCK,
  MAX_EXTRA_REASONING_STEPS,
} from "@/prompts/persona_style_prompt";

describe("persona style blocks", () => {
  it("carries the caveman house style", () => {
    expect(CAVEMAN_BLOCK.length).toBeGreaterThan(0);
    expect(CAVEMAN_BLOCK).toContain("Answer first");
    expect(CAVEMAN_BLOCK).toContain("Payload verbatim");
    expect(CAVEMAN_BLOCK).toContain("not, never, no, only, except");
    expect(CAVEMAN_BLOCK).toContain(
      "The structured output wins over the style",
    );
  });

  it("bounds the extra reasoning allowance", () => {
    expect(HEADROOM_BLOCK.length).toBeGreaterThan(0);
    expect(HEADROOM_BLOCK).toContain(
      `up to ${MAX_EXTRA_REASONING_STEPS} additional reasoning steps`,
    );
    expect(HEADROOM_BLOCK).toContain("correctness, not verbosity");
    expect(MAX_EXTRA_REASONING_STEPS).toBeGreaterThan(0);
  });

  it("gives every persona the same style", () => {
    const blocks = buildPersonaStyleBlocks("explorer");
    expect(blocks).toContain(CAVEMAN_BLOCK);
    expect(blocks).toContain(HEADROOM_BLOCK);
    expect(buildPersonaStyleBlocks("implementer")).toBe(blocks);
    expect(buildPersonaStyleBlocks("reviewer")).toBe(blocks);
  });
});
