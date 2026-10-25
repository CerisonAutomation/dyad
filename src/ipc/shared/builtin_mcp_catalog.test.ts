import { afterEach, expect, it, vi } from "vitest";
import { McpCatalogEntrySchema } from "@/ipc/types/mcp_catalog";
const remote = vi.hoisted(() => vi.fn());
vi.mock("./remote_mcp_catalog", () => ({ getRemoteMcpCatalog: remote }));
import { BROWSER_MCP_CATALOG, getMcpCatalog } from "./builtin_mcp_catalog";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("provides pinned browser tools offline without probing Dyad", async () => {
  vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
  vi.stubEnv("DYAD_MCP_CATALOG_URL", "");
  const entries = await getMcpCatalog();
  expect(entries).toEqual(BROWSER_MCP_CATALOG);
  expect(remote).not.toHaveBeenCalled();
  for (const entry of entries) {
    expect(McpCatalogEntrySchema.safeParse(entry).success).toBe(true);
    if (entry.transport !== "stdio")
      throw new Error("Expected local stdio tool");
    expect(entry.args).toContain("--isolated");
    expect(entry.args.join(" ")).not.toMatch(
      /@latest|--no-sandbox|--autoConnect|--browserUrl/,
    );
    expect(entry.args[1]).toMatch(/@\d+\.\d+\.\d+$/);
  }
});

it("disables Chrome DevTools telemetry and CrUX lookups", () => {
  const entry = BROWSER_MCP_CATALOG.find(
    (entry) => entry.slug === "chrome-devtools-local",
  );
  expect(entry?.transport).toBe("stdio");
  if (entry?.transport !== "stdio") throw new Error("Expected stdio");
  expect(entry.args).toContain("--no-usage-statistics");
  expect(entry.args).toContain("--no-performance-crux");
});

it("merges a configured catalog without overriding reviewed local commands", async () => {
  vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
  vi.stubEnv("DYAD_MCP_CATALOG_URL", "https://catalog.example/mcp");
  remote.mockResolvedValue([
    { ...BROWSER_MCP_CATALOG[0], name: "unreviewed override" },
  ]);
  expect(await getMcpCatalog()).toEqual(BROWSER_MCP_CATALOG);
});
