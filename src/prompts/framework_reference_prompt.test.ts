import { describe, expect, it } from "vitest";
import {
  FRAMEWORK_REFERENCE_PROMPT,
  DEFAULT_PROJECT_RULES,
} from "./framework_reference_prompt";
import {
  constructBuildAgentPrompt,
  constructImplementerPrompt,
  constructLocalAgentPrompt,
} from "./local_agent_prompt";
import { constructPlanModePrompt } from "./plan_mode_prompt";
import { getSystemPromptForChatMode } from "./system_prompt";

describe("on-demand framework knowledge", () => {
  it("keeps routing small and preserves evidence and permission boundaries", () => {
    expect(FRAMEWORK_REFERENCE_PROMPT.length).toBeLessThan(1300);
    for (const term of [
      "installed versions",
      "do not assume React",
      "if read_guide is available",
      "framework-rust",
      "framework-svelte",
      "framework-flutter",
      "framework-tauri",
      "framework-selection",
      "context7-reference",
      "ui-registries",
      "read-only mode",
      "provider/model selection",
      "network limits",
      "untrusted data",
      "blocked retrieval",
      "do not invent expert reviews",
    ])
      expect(FRAMEWORK_REFERENCE_PROMPT).toContain(term);
    expect(FRAMEWORK_REFERENCE_PROMPT).not.toContain("cargo test");
    expect(FRAMEWORK_REFERENCE_PROMPT).not.toContain("https://context7.com/");
  });

  const prompts = [
    ["root", () => constructLocalAgentPrompt(undefined)],
    [
      "read-only",
      () => constructLocalAgentPrompt(undefined, undefined, { readOnly: true }),
    ],
    ["build agent", () => constructBuildAgentPrompt(undefined)],
    ["implementer", () => constructImplementerPrompt(undefined)],
    ["plan", () => constructPlanModePrompt(undefined)],
    [
      "legacy build",
      () =>
        getSystemPromptForChatMode({
          chatMode: "build",
          enableTurboEditsV2: false,
        }),
    ],
    [
      "legacy ask",
      () =>
        getSystemPromptForChatMode({
          chatMode: "ask",
          enableTurboEditsV2: false,
        }),
    ],
  ] as const;
  it.each(prompts)(
    "routes %s to guides exactly once without embedding them",
    (_name, build) => {
      const prompt = build();
      expect(prompt.split("<framework_reference>")).toHaveLength(2);
      expect(prompt).toContain(FRAMEWORK_REFERENCE_PROMPT);
      if (
        _name === "root" ||
        _name === "read-only" ||
        _name === "build agent" ||
        _name === "implementer"
      ) {
        expect(prompt).toContain(DEFAULT_PROJECT_RULES);
        expect(prompt).not.toContain("You are building a React application.");
        expect(prompt).not.toContain("You ALREADY have ALL");
      }
      expect(prompt).not.toContain("# Rust application engineering");
      expect(prompt).not.toContain(
        "# Flutter and Dart application engineering",
      );
    },
  );
});
