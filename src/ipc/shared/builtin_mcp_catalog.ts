import { UI_REGISTRY_MCP_PRESETS } from "../../../shared/ui_registry_mcp_presets";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { isDyadCloudAllowed } from "@/main/dyad_cloud_policy";
import { getRemoteMcpCatalog } from "./remote_mcp_catalog";

/** Pinned local stdio servers. Adding a catalog entry does not install or run it.
 * The existing setup/consent flow remains responsible for starting each server.
 */
import { BROWSER_MCP_PRESETS } from "../../../shared/browser_mcp_presets";

export const BROWSER_MCP_CATALOG: readonly McpCatalogEntry[] =
  BROWSER_MCP_PRESETS.map((entry) => ({ ...entry, args: [...entry.args] }));

export const UI_REGISTRY_MCP_CATALOG: readonly McpCatalogEntry[] =
  UI_REGISTRY_MCP_PRESETS.map((entry) => ({
    ...entry,
    args: [...entry.args],
    inputs: entry.inputs.map((input) => ({ ...input })),
  }));
export const BUILTIN_MCP_CATALOG = [
  ...BROWSER_MCP_CATALOG,
  ...UI_REGISTRY_MCP_CATALOG,
];

export async function getMcpCatalog(): Promise<McpCatalogEntry[]> {
  // Provider-only mode must not probe the Dyad catalog. An explicitly configured
  // non-Dyad catalog is still permitted (and subject to the network guard).
  const remote =
    isDyadCloudAllowed() || process.env.DYAD_MCP_CATALOG_URL
      ? await getRemoteMcpCatalog()
      : [];
  const entries = new Map(
    BUILTIN_MCP_CATALOG.map((entry) => [entry.slug, entry]),
  );
  for (const entry of remote)
    if (!entries.has(entry.slug)) entries.set(entry.slug, entry);
  return [...entries.values()];
}
