import { describe, expect, it } from "vitest";
import {
  constructBuildAgentPrompt,
  constructImplementerPrompt,
  constructLocalAgentPrompt,
} from "@/prompts/local_agent_prompt";
import { constructPlanModePrompt } from "@/prompts/plan_mode_prompt";
import { getSystemPromptForChatMode } from "@/prompts/system_prompt";

/**
 * The engineering discipline comes from the masseater skills. This test locks
 * the representative rules of each skill into every prompt variant, so a
 * refactor cannot silently drop one of them.
 */
const SKILL_MARKERS: Record<string, string[]> = {
  "poteto-principles": [
    "Fix root causes, not symptoms",
    "Prove it works",
    "Never weaken a check to make it pass",
    "Attack the premise",
    "Model the domain in data",
    "Make illegal states unrepresentable",
    "Keep validation at the boundaries",
    "Minimise reader load",
    "Subtract before you add",
    "Sequence work into verifiable units",
    "Test behaviour, not implementation",
    "Encode lessons in structure",
    "Build the lever",
    "Never block on the human",
    "Explain the number",
    "Make operations idempotent",
    "Guard the context window",
    "Experience over implementation convenience",
  ],
  "dont-it-yourself": [
    "Search for what already exists",
    "Do not write a wrapper",
  ],
  integrate: ["Make the old approach unusable", "Move the existing equivalent"],
  "measure-dont-guess": [
    "Write the hypothesis and the value you will accept",
    "Measure in production",
    "Label every unmeasured claim as a guess",
  ],
  "how-to-use-react": [
    "Decide where each piece of state lives",
    "Fix async waterfalls",
    "An effect is for synchronising with something React does not know about",
    "Do not write `useMemo`",
    "Shape the props so the call site reads as the intent",
    "React guarantees consistency and immediacy",
  ],
  writing: [
    "State the purpose before the means",
    "Do not duplicate information the code already carries",
  ],
  "humanity-and-humanness": [
    "Write for a reader who completes the text rather than transcribes it",
    "A person often cannot state their judgement until they react to something concrete",
  ],
};

/**
 * The React skill only applies where the agent authors or plans React code.
 * Ask mode reads and advises on existing code, so it is checked separately.
 */
const REACT_SKILL = "how-to-use-react";

function expectMarkers(
  prompt: string,
  markersBySkill: Record<string, string[]>,
  skills: string[],
) {
  const haystack = prompt.toLowerCase();
  for (const skill of skills) {
    const markers = markersBySkill[skill];
    // A missing entry means the test asked for a skill that does not exist.
    // Silently skipping it would let the assertions pass for the wrong reason.
    expect(markers, `no markers registered for skill: ${skill}`).toBeDefined();
    for (const marker of markers ?? []) {
      expect(
        haystack.includes(marker.toLowerCase()),
        `expected ${skill} marker in prompt: ${marker}`,
      ).toBe(true);
    }
  }
}

function expectSkillMarkers(prompt: string, skills: string[]) {
  expectMarkers(prompt, SKILL_MARKERS, skills);
}

function expectAllSkillMarkers(prompt: string) {
  expectSkillMarkers(prompt, Object.keys(SKILL_MARKERS));
}

/**
 * The Replica pack: every stage and every hard rule, locked into every prompt
 * variant so a refactor cannot silently drop one.
 */
const REPLICA_SKILL_MARKERS: Record<string, string[]> = {
  clone_workflow_rules: [
    "Rebuild functionality and UX patterns, clean-room",
    "Public sources and the user's own account only",
    "Reading, not scraping",
    "No source code, no private APIs",
    "Check the terms",
    "Never fabricate",
    "Every quote is verbatim and linked",
    "No fake reviews, ever",
    "Official, public APIs only, with the user's own keys",
    "The user creates accounts and keys",
    "Test your clone, not the original",
    "No fake proof",
    "Nothing goes live without the user's go",
  ],
  clone_workflow_artifacts: [
    "replica/recon.md",
    "replica/features.csv",
    "replica/architecture.md",
    "replica/design/tokens.json",
    "replica/backend.md",
    "replica/test-plan.md",
    "replica/bugs.md",
    "replica/fixes.md",
    "replica/brand.md",
    "replica/launch/",
    "replica/parity.md",
    "replica/deploy.md",
  ],
  clone_workflow_stages: [
    "1. Recon",
    "2. Architect",
    "3. Design",
    "4. Build",
    "5. Backend",
    "6. Test",
    "7. Review research",
    "8. Diff",
    "9. Brand",
    "10. Launch",
    "11. Deploy",
    "not shippable",
    "better than the original",
    "Vertical slice",
    "AA is the floor",
    "one-click cancel",
  ],
};

/**
 * The skills that only apply to a particular kind of task. They are not in
 * the system prompt - they arrive with the message that invokes them. Their
 * markers are asserted in builtin_skills.test.ts, which owns that contract.
 */

function expectReplicaMarkers(prompt: string) {
  expectMarkers(
    prompt,
    REPLICA_SKILL_MARKERS,
    Object.keys(REPLICA_SKILL_MARKERS),
  );
}

function expectNonReactSkillMarkers(prompt: string) {
  expectSkillMarkers(
    prompt,
    Object.keys(SKILL_MARKERS).filter((skill) => skill !== REACT_SKILL),
  );
}

/**
 * Every prompt variant, in the shape the constructors take.
 *
 * Each entry is built twice: once without the Replica workflow and once with
 * it, so the conditional can be asserted on both sides.
 */
function promptVariants(): {
  name: string;
  build: (isCloneWorkflow: boolean) => string;
}[] {
  return [
    {
      name: "Pro local-agent",
      build: (isCloneWorkflow) =>
        constructLocalAgentPrompt(undefined, undefined, { isCloneWorkflow }),
    },
    {
      name: "Basic (free tier) local-agent",
      build: (isCloneWorkflow) =>
        constructLocalAgentPrompt(undefined, undefined, {
          basicAgentMode: true,
          isCloneWorkflow,
        }),
    },
    {
      name: "read-only Ask",
      build: (isCloneWorkflow) =>
        constructLocalAgentPrompt(undefined, undefined, {
          readOnly: true,
          isCloneWorkflow,
        }),
    },
    {
      name: "Build-mode",
      build: (isCloneWorkflow) =>
        constructBuildAgentPrompt(undefined, undefined, { isCloneWorkflow }),
    },
    {
      name: "Implementer sub-agent",
      build: (isCloneWorkflow) =>
        constructImplementerPrompt(undefined, { isCloneWorkflow }),
    },
    {
      name: "plan-mode",
      build: (isCloneWorkflow) =>
        constructPlanModePrompt(undefined, undefined, { isCloneWorkflow }),
    },
    {
      name: "legacy build chat-mode",
      build: (isCloneWorkflow) =>
        getSystemPromptForChatMode({
          chatMode: "build",
          enableTurboEditsV2: false,
          isCloneWorkflow,
        }),
    },
    {
      name: "legacy ask chat-mode",
      build: (isCloneWorkflow) =>
        getSystemPromptForChatMode({
          chatMode: "ask",
          enableTurboEditsV2: false,
          isCloneWorkflow,
        }),
    },
  ];
}

describe("agent discipline blocks in every prompt variant", () => {
  it("carries the always-on skills into every prompt variant", () => {
    for (const variant of promptVariants()) {
      const prompt = variant.build(false);
      if (variant.name === "read-only Ask") {
        // Ask mode reads and advises; it does not author React components.
        expectNonReactSkillMarkers(prompt);
        expect(prompt).not.toContain("<react_state_placement>");
      } else {
        expectAllSkillMarkers(prompt);
      }
      expect(prompt, variant.name).toContain("<engineering_principles>");
      expect(prompt, variant.name).toContain("<reuse_before_writing>");
      expect(prompt, variant.name).toContain("<integration_migration>");
      expect(prompt, variant.name).toContain("<measurement_discipline>");
      expect(prompt, variant.name).toContain("<human_reading>");
      expect(prompt, variant.name).toContain("<writing_rules>");
    }
  });

  it("carries the skill catalog into every prompt variant", () => {
    for (const variant of promptVariants()) {
      const prompt = variant.build(false);
      expect(prompt, variant.name).toContain("<skills>");
      expect(prompt, variant.name).toContain("/replica-recon");
      expect(prompt, variant.name).toContain("/setup-template");
      expect(prompt, variant.name).toContain("/skill-authoring");
    }
  });

  it("leaves no skill placeholder unresolved in any prompt variant", () => {
    for (const variant of promptVariants()) {
      for (const isCloneWorkflow of [false, true]) {
        const prompt = variant.build(isCloneWorkflow);
        expect(prompt, variant.name).not.toContain("[[SKILLS]]");
      }
    }
  });

  it("leaves the Replica pack out of a conversation that is not a clone", () => {
    for (const variant of promptVariants()) {
      const prompt = variant.build(false);
      expect(prompt, variant.name).not.toContain("<clone_workflow_stages>");
      expect(prompt, variant.name).not.toContain("<clone_workflow_rules>");
      expect(prompt, variant.name).not.toContain("replica/features.csv");
    }
  });

  it("carries the Replica pack into a clone conversation", () => {
    for (const variant of promptVariants()) {
      const prompt = variant.build(true);
      expectReplicaMarkers(prompt);
    }
  });
});

describe("the situational skills arrive with the message that invokes them", () => {
  it("keeps them out of the system prompt", () => {
    for (const variant of promptVariants()) {
      const prompt = variant.build(false);
      expect(prompt, variant.name).not.toContain("<skill_authoring>");
      expect(prompt, variant.name).not.toContain("<setup_verification>");
    }
  });
});
