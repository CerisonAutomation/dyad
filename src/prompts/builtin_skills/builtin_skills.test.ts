import { describe, expect, it } from "vitest";
import {
  BUILTIN_SKILL_CATALOG,
  BUILTIN_SKILL_SLUGS,
} from "@/prompts/builtin_skills/catalog";
import { BUILTIN_SKILL_CONTENT } from "@/prompts/builtin_skills/content";
import { replaceSlashSkillReference } from "@/ipc/utils/replaceSlashSkillReference";
import { REPLICA_SKILL_BLOCKS } from "@/prompts/replica_skills_prompt";

/**
 * The built-in skills are the ones that are not in the system prompt. They
 * arrive with the message that invokes them, so the contract is: the catalog
 * names them, the body exists for every name, and the slash command reaches
 * the body.
 */

/** Representative rules of each situational skill. */
const SKILL_MARKERS: Record<string, string[]> = {
  "skill-authoring": [
    "Derive the body from why it is needed",
    "Write the requester's judgement, not your own",
    "Put the reason next to the rule it justifies",
    "Write what to do, not what to avoid",
    "One document carries one kind of content",
    "Delegate by name, do not restate",
    "Encode repeated instructions as structure",
    "Ask through drafts and reactions",
  ],
  "setup-template": [
    "Compare against the skeleton",
    "Judge each element on three points",
    "Prove it with the real thing",
    "Give a binary verdict",
    "Inspect without fixing",
  ],
};

/** The boundaries that hold across every stage of the Replica pack. */
const REPLICA_RULE_MARKERS = [
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
];

describe("the built-in skill catalog", () => {
  it("gives every skill a unique, invocable slug", () => {
    const slugs = BUILTIN_SKILL_CATALOG.map((skill) => skill.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug, `slug must be invocable: ${slug}`).toMatch(
        /^[a-zA-Z0-9-]+$/,
      );
    }
  });

  it("gives every skill a description, and a moment to use it", () => {
    for (const skill of BUILTIN_SKILL_CATALOG) {
      expect(skill.description.length, skill.slug).toBeGreaterThan(0);
      expect(skill.whenToUse.length, skill.slug).toBeGreaterThan(0);
    }
  });

  it("lists every Replica stage and both situational skills", () => {
    expect(BUILTIN_SKILL_SLUGS).toEqual([
      ...Object.keys(REPLICA_SKILL_BLOCKS),
      "skill-authoring",
      "setup-template",
    ]);
  });
});

describe("the built-in skill bodies", () => {
  it("has a body for every skill in the catalog", () => {
    for (const slug of BUILTIN_SKILL_SLUGS) {
      expect(
        BUILTIN_SKILL_CONTENT[slug],
        `missing body: ${slug}`,
      ).toBeDefined();
      expect(BUILTIN_SKILL_CONTENT[slug].length, slug).toBeGreaterThan(0);
    }
  });

  it("has no body that the catalog does not name", () => {
    expect(Object.keys(BUILTIN_SKILL_CONTENT).sort()).toEqual(
      [...BUILTIN_SKILL_SLUGS].sort(),
    );
  });

  it("carries the situational skills' rules", () => {
    for (const [slug, markers] of Object.entries(SKILL_MARKERS)) {
      const body = BUILTIN_SKILL_CONTENT[slug];
      expect(body, slug).toBeDefined();
      for (const marker of markers) {
        expect(body, `${slug} is missing: ${marker}`).toContain(marker);
      }
    }
  });

  it("carries the Replica boundaries into every stage", () => {
    for (const slug of Object.keys(REPLICA_SKILL_BLOCKS)) {
      const body = BUILTIN_SKILL_CONTENT[slug];
      for (const marker of REPLICA_RULE_MARKERS) {
        expect(body, `${slug} is missing: ${marker}`).toContain(marker);
      }
    }
  });
});

describe("the slash command reaches the skill body", () => {
  it("expands a built-in slug into its instructions", () => {
    const expanded = replaceSlashSkillReference(
      "/replica-recon now",
      BUILTIN_SKILL_CONTENT,
    );
    expect(expanded).not.toContain("/replica-recon");
    expect(expanded).toContain("<replica_recon>");
    expect(expanded).toContain("Reverse-engineer the app into a map");
  });

  it("leaves an unknown slug alone", () => {
    const input = "/not-a-skill here";
    expect(replaceSlashSkillReference(input, BUILTIN_SKILL_CONTENT)).toBe(
      input,
    );
  });
});
