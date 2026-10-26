import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asSchema } from "ai";
import { TOOL_DEFINITIONS, shouldIncludeTool } from "./tool_definitions";
import type { AgentContext, ToolDefinition } from "./tools/types";
import type { UserSettings } from "@/lib/schemas";

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock("@/main/settings", () => ({
  readSettings: () => state.settings,
  writeSettings: vi.fn(),
}));
function settings(
  source: "api-key" | "subscription" = "api-key",
): UserSettings {
  return {
    proModelUsage: source,
    selectedModel: {
      provider: "qa-fixture-provider",
      name: "qa-fixture-model",
    },
    enableShellTool: true,
    runtimeMode2: "host",
    agentToolConsents: {},
  } as unknown as UserSettings;
}
function context(source: "api-key" | "subscription" = "api-key"): AgentContext {
  return {
    inferenceSettings: settings(source),
    isDyadPro: false,
    appPath: "/qa-fixture",
    referencedApps: new Map(),
    testingEnabled: true,
    preCommitHookAvailable: true,
    canUseExplorerSubagent: true,
    canUseImplementerSubagent: true,
    canUseAdvancedSubagentTools: true,
    isMcpToolSearchAvailable: true,
    mcpToolDefs: [],
    suggestablePlugins: [],
  } as unknown as AgentContext;
}
const modifies = (tool: ToolDefinition, ctx: AgentContext) =>
  typeof tool.modifiesState === "function"
    ? tool.modifiesState(ctx)
    : tool.modifiesState === true;
const readOnlyAllowed = (tool: ToolDefinition, ctx: AgentContext) =>
  typeof tool.allowInReadOnlyModes === "function"
    ? tool.allowInReadOnlyModes(ctx)
    : tool.allowInReadOnlyModes === true;

beforeEach(() => {
  state.settings = settings() as unknown as Record<string, unknown>;
});
describe("complete registered tool contract and availability audit", () => {
  it("has unique, valid names", () => {
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(50);
    expect(new Set(TOOL_DEFINITIONS.map((t) => t.name)).size).toBe(
      TOOL_DEFINITIONS.length,
    );
  });
  it.each(TOOL_DEFINITIONS.map((tool) => [tool.name, tool] as const))(
    "%s has a serializable schema and preserves capability boundaries",
    async (_name, tool) => {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.trim().length).toBeGreaterThan(10);
      expect(["always", "ask", "never"]).toContain(tool.defaultConsent);
      expect(tool.execute).toBeTypeOf("function");
      const schema = await asSchema(tool.inputSchema).jsonSchema;
      expect(JSON.parse(JSON.stringify(schema))).toHaveProperty(
        "type",
        "object",
      );
      for (const source of ["api-key", "subscription"] as const) {
        const ctx = context(source);
        // Stale commercial entitlements must never advertise an unusable Engine adapter.
        if (tool.usesEngineEndpoint)
          for (const phase of ["discovery", "invocation"] as const)
            expect(
              shouldIncludeTool(tool, { ...ctx, isDyadPro: true }, {}, phase),
            ).toBe(false);
        if (modifies(tool, ctx) && !readOnlyAllowed(tool, ctx))
          expect(
            shouldIncludeTool(tool, ctx, { readOnly: true }, "invocation"),
          ).toBe(false);
        state.settings = {
          ...settings(source),
          agentToolConsents: { [tool.name]: "never" },
        };
        for (const phase of ["discovery", "invocation"] as const)
          expect(shouldIncludeTool(tool, ctx, {}, phase)).toBe(false);
        state.settings = settings(source) as unknown as Record<string, unknown>;
      }
    },
  );
  it.each(["web_fetch", "web_crawl"])(
    "makes %s available to the builder without commercial gating",
    (name) => {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name)!;
      for (const source of ["api-key", "subscription"] as const)
        expect(
          shouldIncludeTool(tool, context(source), { toolProfile: "build" }),
        ).toBe(true);
      expect(tool.defaultConsent).toBe("ask");
    },
  );
  it("can emit a reproducible fixture-only inventory without claiming live integration", () => {
    const rows = TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      consent: tool.defaultConsent,
      modifiesState:
        typeof tool.modifiesState === "function"
          ? "context-dependent"
          : tool.modifiesState === true,
      engineAdapter: tool.usesEngineEndpoint === true,
      hasEligibilityGate: !!tool.isEnabled,
      hasDiscoveryGate: !!tool.isDiscoverable,
      scenarios: Object.fromEntries(
        ["api-key", "subscription"].map((source) => {
          const ctx = context(source as "api-key" | "subscription");
          return [
            source,
            Object.fromEntries(
              [
                ["agent", {}],
                ["build", { toolProfile: "build" }],
                ["ask", { readOnly: true }],
                ["plan", { planModeOnly: true }],
              ].map(([mode, options]) => [
                mode,
                shouldIncludeTool(
                  tool,
                  ctx,
                  options as Parameters<typeof shouldIncludeTool>[2],
                ),
              ]),
            ),
          ];
        }),
      ),
      executionEvidence:
        "Registry/schema/policy checks only; inspect per-tool test and runtime results separately",
    }));
    const output = process.env.AGENT2_TOOL_INVENTORY_OUTPUT;
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(
        output,
        JSON.stringify(
          {
            scope:
              "All built-in registered tools; synthetic contexts, not installed user integrations or live provider calls",
            count: rows.length,
            tools: rows,
          },
          null,
          2,
        ) + "\n",
      );
    }
    expect(rows).toHaveLength(TOOL_DEFINITIONS.length);
  });
});
