import { describe, expect, it } from "vitest";
import { codingQualityContract } from "./coding_quality_contract";
import {
  constructLocalAgentPrompt,
  constructBuildAgentPrompt,
  constructImplementerPrompt,
} from "./local_agent_prompt";

describe("coding quality contract", () => {
  it("stays bounded and addresses evidence, security and user-visible outcomes", () => {
    const prompt = codingQualityContract();
    expect(prompt.length).toBeLessThan(3000);
    for (const term of [
      "observable acceptance criteria",
      "installed version",
      "permission boundaries",
      "HTTP 200 alone",
      "keyboard access",
      "authorization",
      "not run is not a pass",
      "mock fixtures",
      "unbounded retry loop",
    ])
      expect(prompt).toContain(term);
    expect(prompt).not.toMatch(/always use <think>|reveal.*chain.of.thought/i);
  });
  it("does not promise unavailable tools or unconditional expensive builds", () => {
    expect(codingQualityContract()).not.toMatch(
      /run_tests|run_build|run_pre_commit|npm install/,
    );
    expect(codingQualityContract()).toContain("only available tools");
  });
  it("keeps read-only work non-mutating", () => {
    const prompt = constructLocalAgentPrompt("Repository rule", undefined, {
      readOnly: true,
    });
    expect(prompt).toContain("This is read-only");
    expect(prompt).not.toContain("Implement the smallest coherent change");
  });
  it("adds one contract after user-controlled theme content", () => {
    const prompt = constructBuildAgentPrompt(
      "Repository rule",
      "Unique theme marker",
    );
    expect(prompt.split("<coding_quality_contract>")).toHaveLength(2);
    expect(prompt.indexOf("<coding_quality_contract>")).toBeGreaterThan(
      prompt.indexOf("Unique theme marker"),
    );
  });
  it("preserves implementer ownership boundaries", () => {
    const prompt = constructImplementerPrompt("Repository rule");
    expect(prompt).toContain("Report blockers and evidence to the root Agent");
    expect(prompt).toContain("do not invent APIs");
  });
});
