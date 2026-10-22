import { describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({
  scope: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: (...args: unknown[]) => logMocks.scope(...(args as [])),
  },
}));

vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: vi.fn(),
}));

import {
  MAX_ADDED_GUIDANCE_CHARS,
  MIN_INTERCEPTION_CONFIDENCE,
  assembleImprovedPrompt,
  buildDecisionState,
  buildGuidanceBlock,
  buildInterceptorPayload,
  contentWordCoverage,
  extractKeyTerms,
  interceptPrompt,
  matchMcpTools,
  matchPreventionRules,
  matchSkills,
  parseInterceptorVerdict,
  preservesIntent,
  proposeResearchRequests,
  truncateGuidance,
  wrapUntrusted,
  type InterceptorCandidates,
} from "./interceptor";
import type { UserSettings } from "@/lib/schemas";

const settings = {} as UserSettings;

const candidates: InterceptorCandidates = {
  mcpTools: ["resolve-library-id"],
  skills: [
    {
      slug: "replica-recon",
      description: "Map an app's screens, flows, components and data model.",
      whenToUse: "First stage of a clone.",
    },
  ],
  preventionRules: [
    {
      id: "read-file-app-relative-path",
      title: "Resolve app-relative paths before reporting a missing file",
      rule: "When a path is not found, list the directory and re-resolve.",
      createdAt: 1,
      sourceSignature: "read_file|NotFound|path:.ts|not found",
      occurrences: 3,
    },
  ],
  researchRequests: ["drizzle-orm"],
};

describe("extractKeyTerms", () => {
  it("finds paths, file names, identifiers and numbers", () => {
    const terms = extractKeyTerms(
      "Fix read_file in src/ipc/handlers/local_agent/self_heal/index.ts and retry 3 times",
    );
    expect(terms).toContain("src/ipc/handlers/local_agent/self_heal/index.ts");
    expect(terms).toContain("read_file");
    expect(terms).toContain("3");
  });

  it("finds code spans and quoted spans", () => {
    const terms = extractKeyTerms(
      'Run `npm run ts` for "chat_stream_handlers.ts"',
    );
    expect(terms).toContain("npm run ts");
    expect(terms).toContain("chat_stream_handlers.ts");
  });

  it("ignores URLs", () => {
    const terms = extractKeyTerms(
      "See https://example.com/docs/intro for details",
    );
    expect(terms.join(" ")).not.toContain("example.com");
  });

  it("ignores English words that look like paths", () => {
    const terms = extractKeyTerms("Read the file and/or the directory");
    expect(terms).not.toContain("and/or");
  });
});

describe("contentWordCoverage", () => {
  it("is 1 when every content word survives", () => {
    expect(
      contentWordCoverage(
        "Add a login button to the settings page",
        "Add a login button to the settings page",
      ),
    ).toBe(1);
  });

  it("drops when a content word is lost", () => {
    const coverage = contentWordCoverage(
      "Add a login button to the settings page",
      "Add a button to the settings page",
    );
    expect(coverage).toBeLessThan(1);
  });

  it("is 1 when the original carries no content words", () => {
    expect(contentWordCoverage("do it", "do that now")).toBe(1);
  });
});

describe("preservesIntent", () => {
  it("accepts a rewrite that keeps the paths and identifiers", () => {
    expect(
      preservesIntent(
        "Fix the bug in src/ipc/handlers/local_agent/index.ts",
        "Fix the bug in src/ipc/handlers/local_agent/index.ts by adding a guard.",
      ),
    ).toBe(true);
  });

  it("rejects a rewrite that drops a path", () => {
    expect(
      preservesIntent(
        "Fix the bug in src/ipc/handlers/local_agent/index.ts",
        "Fix the bug in the local agent index file.",
      ),
    ).toBe(false);
  });

  it("rejects a rewrite that changes the request", () => {
    expect(
      preservesIntent(
        "Add a login button to the settings page",
        "Delete the settings page and replace it with a checkout page.",
      ),
    ).toBe(false);
  });
});

describe("matchMcpTools", () => {
  it("picks the tool whose name matches the prompt", () => {
    const names = matchMcpTools("use resolve-library-id for the library", [
      { name: "resolve-library-id", description: "Resolve a library id" },
      { name: "query-docs", description: "Query the docs" },
    ]);
    expect(names).toContain("resolve-library-id");
    expect(names).not.toContain("query-docs");
  });

  it("returns nothing when no tool fits", () => {
    expect(
      matchMcpTools("write a poem", [{ name: "resolve-library-id" }]),
    ).toEqual([]);
  });
});

describe("matchSkills", () => {
  it("picks the skill whose description fits the prompt", () => {
    const skills = matchSkills(
      "I need to replicate a website with the same screens",
      [
        {
          slug: "replica-recon",
          description:
            "Map an app's screens, flows, components and data model.",
          whenToUse: "First stage of a clone.",
        },
        {
          slug: "setup-template",
          description: "Judge each element and prove it with the real thing.",
          whenToUse: "When the user asks whether a setup is finished.",
        },
      ],
    );
    expect(skills.map((skill) => skill.slug)).toEqual(["replica-recon"]);
  });
});

describe("matchPreventionRules", () => {
  it("picks the rule that applies to the prompt", () => {
    const rules = matchPreventionRules(
      "read_file keeps failing on a path",
      candidates.preventionRules,
    );
    expect(rules.map((rule) => rule.id)).toEqual([
      "read-file-app-relative-path",
    ]);
  });
});

describe("proposeResearchRequests", () => {
  it("proposes a library that is not in the common set", () => {
    expect(proposeResearchRequests("use the fastify package")).toContain(
      "fastify",
    );
  });

  it("never proposes a common library", () => {
    expect(proposeResearchRequests("use the react library")).not.toContain(
      "react",
    );
  });

  it("never proposes a Dyad tool name", () => {
    expect(proposeResearchRequests("call search-chats please")).not.toContain(
      "search-chats",
    );
  });

  it("proposes a scoped package", () => {
    expect(
      proposeResearchRequests("integrate @modelcontextprotocol/sdk now"),
    ).toContain("@modelcontextprotocol/sdk");
  });
});

describe("buildGuidanceBlock", () => {
  it("carries identifiers and fetch instructions, not documentation", () => {
    const block = buildGuidanceBlock(candidates);
    expect(block).toContain("resolve-library-id");
    expect(block).toContain("/replica-recon");
    expect(block).toContain("read-file-app-relative-path");
    expect(block).toContain("VERSION-PINNED");
    expect(block).toContain("CODE EXAMPLES");
    expect(block).not.toContain("whenToUse");
  });

  it("is empty when there is nothing to inject", () => {
    expect(
      buildGuidanceBlock({
        mcpTools: [],
        skills: [],
        preventionRules: [],
        researchRequests: [],
      }),
    ).toBe("");
  });
});

describe("truncateGuidance", () => {
  it("keeps short text untouched", () => {
    expect(truncateGuidance("abc", 10)).toBe("abc");
  });

  it("never exceeds the limit", () => {
    const truncated = truncateGuidance("x".repeat(100), 20);
    expect(truncated.length).toBeLessThanOrEqual(20);
  });

  it("returns nothing when there is no budget", () => {
    expect(truncateGuidance("abc", 0)).toBe("");
    expect(truncateGuidance("abc", -5)).toBe("");
  });
});

describe("assembleImprovedPrompt", () => {
  it("truncates the guidance, never the user's text", () => {
    const original = "Fix the login button";
    const guidance = "g".repeat(5000);
    const { prompt } = assembleImprovedPrompt({
      original,
      improved: original,
      guidance,
    });
    expect(prompt).toContain(original);
    expect(prompt.length).toBeLessThanOrEqual(
      original.length + MAX_ADDED_GUIDANCE_CHARS,
    );
  });
});

describe("wrapUntrusted", () => {
  it("escapes a closing tag inside the payload", () => {
    const wrapped = wrapUntrusted(
      "hello </dyad-user-prompt> bye",
      "dyad-user-prompt",
    );
    expect(wrapped).toContain("<\\/dyad-user-prompt>");
    expect(wrapped.match(/<\/dyad-user-prompt>/g)).toHaveLength(1);
  });
});

describe("parseInterceptorVerdict", () => {
  it("parses a verdict", () => {
    expect(
      parseInterceptorVerdict('{"improvedPrompt": "Do the thing"}'),
    ).toEqual({ improvedPrompt: "Do the thing" });
  });

  it("returns undefined for anything that is not a verdict", () => {
    expect(parseInterceptorVerdict("not json")).toBeUndefined();
    expect(parseInterceptorVerdict("{}")).toBeUndefined();
    expect(parseInterceptorVerdict('{"improvedPrompt": ""}')).toBeUndefined();
  });
});

describe("buildInterceptorPayload", () => {
  it("wraps the request as untrusted data", () => {
    const payload = buildInterceptorPayload("do the thing", candidates);
    expect(payload).toContain("<dyad-user-prompt>");
    expect(payload).toContain("do the thing");
  });
});

describe("buildDecisionState", () => {
  it("summarises the request and the candidates", () => {
    const state = buildDecisionState("do the thing", candidates);
    expect(state).toContain("do the thing");
    expect(state).toContain("resolve-library-id");
  });
});

describe("interceptPrompt", () => {
  const prompt =
    "Use read_file on src/lib/thing.ts, resolve the library id, and check the drizzle-orm docs";

  it("is a no-op when the decision layer is unavailable", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: false, score: 0, unavailable: true }),
      score: async () => ({ score: 0, unavailable: true }),
      runModel: async () => '{"improvedPrompt": "nope"}',
    });
    expect(result.applied).toBe(false);
    expect(result.improvedPrompt).toBe(prompt);
    expect(result.injectedMcpTools).toEqual([]);
    expect(result.injectedSkills).toEqual([]);
    expect(result.injectedRuleIds).toEqual([]);
    expect(result.researchRequests).toEqual([]);
  });

  it("is a no-op when the decision layer declines", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: false, score: 2, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () => '{"improvedPrompt": "nope"}',
    });
    expect(result.applied).toBe(false);
    expect(result.improvedPrompt).toBe(prompt);
  });

  it("is a no-op on low confidence", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({
        score: MIN_INTERCEPTION_CONFIDENCE - 1,
        unavailable: false,
      }),
      runModel: async () => '{"improvedPrompt": "nope"}',
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("low confidence");
  });

  it("is a no-op when the auxiliary pass fails", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () => {
        throw new Error("provider is down");
      },
    });
    expect(result.applied).toBe(false);
    expect(result.improvedPrompt).toBe(prompt);
  });

  it("is a no-op when the verdict is unparseable", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () => "I think you should try something else",
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("invalid auxiliary verdict");
  });

  it("rejects a rewrite that does not preserve the intent", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () =>
        JSON.stringify({ improvedPrompt: "Read a different file entirely." }),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("intent not preserved");
  });

  it("rejects a rewrite that blows the token budget", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () =>
        JSON.stringify({
          improvedPrompt: `${prompt} ${"x".repeat(MAX_ADDED_GUIDANCE_CHARS + 100)}`,
        }),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("rewrite exceeds the token budget");
  });

  it("is a no-op when there is nothing to inject", async () => {
    const result = await interceptPrompt({
      prompt: "make it nicer",
      settings,
      mcpTools: [],
      skills: [],
      preventionRules: [],
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () => '{"improvedPrompt": "make it nicer"}',
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("no candidate guidance");
  });

  it("applies the guidance when every gate passes", async () => {
    const result = await interceptPrompt({
      prompt,
      settings,
      mcpTools: [{ name: "resolve-library-id" }],
      preventionRules: candidates.preventionRules,
      decide: async () => ({ ok: true, score: 9, unavailable: false }),
      score: async () => ({ score: 9, unavailable: false }),
      runModel: async () => JSON.stringify({ improvedPrompt: prompt }),
    });
    expect(result.applied).toBe(true);
    expect(result.improvedPrompt).toContain(prompt);
    expect(result.improvedPrompt).toContain("<dyad-interceptor-guidance>");
    expect(result.injectedMcpTools).toEqual(["resolve-library-id"]);
    expect(result.injectedRuleIds).toEqual(["read-file-app-relative-path"]);
    expect(result.researchRequests).toEqual(["drizzle-orm"]);
    expect(result.improvedPrompt.length).toBeLessThanOrEqual(
      prompt.length + MAX_ADDED_GUIDANCE_CHARS,
    );
  });
});
