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

/**
 * The pack's own stage content, per stage.
 *
 * These markers are lines from the pack's `SKILL.md` files, not a summary of
 * them, so a body that has been shortened back into a paraphrase loses them
 * and fails. `packBytes` is the size of the pack's file for that stage, and
 * the length floor is a fraction of it: the pack file carries YAML
 * frontmatter that the catalog holds instead, and the body re-flows the
 * markdown, but a stage cannot be delivered in a fraction of its own size
 * without losing steps.
 */
const REPLICA_STAGE_EXPECTATIONS: Record<
  string,
  { packFile: string; packBytes: number; markers: string[] }
> = {
  "replica-recon": {
    packFile: "replica-recon/SKILL.md",
    packBytes: 5497,
    markers: [
      "Step 1: scope",
      "Step 2: list the sources",
      "Step 3: screen inventory",
      "Step 4: user flows",
      "Step 5: components",
      "Step 6: inferred data model",
      "Step 7: feature matrix",
      "Step 8: what cannot be cloned",
      "Step 9: size it",
      "the next step: `/replica-architect`",
      "replica-recon/features.csv",
    ],
  },
  "replica-architect": {
    packFile: "replica-architect/SKILL.md",
    packBytes: 4586,
    markers: [
      "Step 1: the stack",
      "Step 2: the schema",
      "Step 3: the API",
      "Step 4: the parts that bite",
      "Step 5: build order",
      "create table bookings",
      "the next step: `/replica-design`",
      "replica-architect/architecture.md",
    ],
  },
  "replica-design": {
    packFile: "replica-design/SKILL.md",
    packBytes: 3974,
    markers: [
      "Step 1: measure, do not guess",
      "Step 2: write the tokens",
      "Step 3: component specs",
      "Step 4: build the primitives",
      "AA is the floor",
      "border-input",
      "replica-design/tokens.json",
    ],
  },
  "replica-build": {
    packFile: "replica-build/SKILL.md",
    packBytes: 3710,
    markers: [
      "Step 1: the shell",
      "Step 2: the vertical slice",
      "Step 3: screen by screen",
      "Step 4: the build log",
      "Definition of done, per screen",
      "build: S07 booking page",
    ],
  },
  "replica-backend": {
    packFile: "replica-backend/SKILL.md",
    packBytes: 3985,
    markers: [
      "Sessions: http-only secure cookies",
      "checkout.session.completed",
      "customer.subscription.deleted",
      "dead-letter log",
      "zod or similar",
      "npm audit",
      "the checklist ticked",
    ],
  },
  "replica-test": {
    packFile: "replica-test/SKILL.md",
    packBytes: 3273,
    markers: [
      "Step 1: the plan",
      "Step 2: automate what you can",
      "Step 3: click through the rest",
      "Step 4: report bugs",
      "Step 5: fix loop",
      "F01-H1, F01-E3, F01-N2",
      "4000 0000 0000 0002",
      "@axe-core/playwright",
      "replica-test/e2e.example.spec.ts",
    ],
  },
  "replica-diff": {
    packFile: "replica-diff/SKILL.md",
    packBytes: 4099,
    markers: [
      "Step 1: feature parity",
      "Step 2: layout diff",
      "Step 3: behaviour diff",
      "Step 4: the report",
      "matches 90+, close 75+, partly 50+, different",
      "not shippable",
      "better than the original",
      "--mode pixel",
      "replica-diff/parity.py",
    ],
  },
  "replica-entrepreneur": {
    packFile: "replica-entrepreneur/SKILL.md",
    packBytes: 4863,
    markers: [
      "Step 1: collect",
      "Step 2: rank",
      "Step 3: three lists",
      "Step 4: the fix plan",
      "Step 5: the angle",
      "itunes.apple.com/us/rss/customerreviews",
      "hn.algolia.com/api/v1/search",
      "Reviewers are not your testimonials",
      "replica-entrepreneur/reviews.py",
    ],
  },
  "replica-brand": {
    packFile: "replica-brand/SKILL.md",
    packBytes: 4328,
    markers: [
      "Step 1: the name",
      "Step 2: the checks, run, not assumed",
      "Step 3: palette",
      "Step 4: logo brief",
      "Step 5: voice",
      "Step 6: the sweep",
      "tmsearch.uspto.gov",
      "WIPO Global Brand Database",
      "replica-brand/sweep.py",
    ],
  },
  "replica-launch": {
    packFile: "replica-launch/SKILL.md",
    packBytes: 4128,
    markers: [
      "Step 1: landing page",
      "Step 2: pricing",
      "Step 3: store listing",
      "Step 4: launch plan",
      "promotional text 170",
      "App Review Guideline 4.1",
      "replica-launch/listing.example.json",
    ],
  },
  "replica-deploy": {
    packFile: "replica-deploy/SKILL.md",
    packBytes: 4412,
    markers: [
      "Step 1: preflight",
      "Step 2: production services",
      "Step 3: host and domain",
      "Step 4: watch it",
      "Step 5: mobile, if there is an app",
      "v=DMARC1; p=none; rua=mailto:you@yourdomain",
      "cname.vercel-dns.com",
      "replica-deploy/preflight.md",
    ],
  },
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

describe("the Replica stage bodies", () => {
  it("covers every stage the catalog offers", () => {
    expect(Object.keys(REPLICA_STAGE_EXPECTATIONS).sort()).toEqual(
      [...Object.keys(REPLICA_SKILL_BLOCKS)].sort(),
    );
  });

  it("carries the pack's own stage instructions, not a summary of them", () => {
    for (const [slug, expected] of Object.entries(REPLICA_STAGE_EXPECTATIONS)) {
      const body = BUILTIN_SKILL_CONTENT[slug];
      expect(body, `missing body: ${slug}`).toBeDefined();
      for (const marker of expected.markers) {
        expect(body, `${slug} is missing: ${marker}`).toContain(marker);
      }
    }
  });

  it("is as long as the pack's own stage file", () => {
    for (const [slug, expected] of Object.entries(REPLICA_STAGE_EXPECTATIONS)) {
      const block = REPLICA_SKILL_BLOCKS[slug];
      const floor = Math.floor(expected.packBytes * 0.7);
      expect(
        block.length,
        `${slug} is ${block.length} bytes, shorter than the pack's ${expected.packFile} (${expected.packBytes} bytes)`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it("names the review-research stage after the pack", () => {
    expect(BUILTIN_SKILL_SLUGS).toContain("replica-entrepreneur");
    expect(BUILTIN_SKILL_SLUGS).not.toContain("replica-review-research");
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
