// Connect and list tools only. No navigation, logins, model calls, or deployments.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BROWSER_MCP_PRESETS } from "../../shared/browser_mcp_presets.ts";

const selected = process.argv.slice(2);
const presets = selected.length
  ? BROWSER_MCP_PRESETS.filter((entry) => selected.includes(entry.slug))
  : BROWSER_MCP_PRESETS;
if (
  !presets.length ||
  selected.some(
    (slug) => !BROWSER_MCP_PRESETS.some((entry) => entry.slug === slug),
  )
) {
  throw new Error(
    "Unknown browser preset. Use playwright-local or chrome-devtools-local.",
  );
}
for (const preset of presets) {
  // Never forward the shell's model keys, cookies or cloud credentials.
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USERPROFILE",
      "SYSTEMROOT",
      "WINDIR",
      "TEMP",
      "TMP",
      "TMPDIR",
      "NODE_EXTRA_CA_CERTS",
    ].flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  );
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: [...preset.args],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "dyad-browser-qa", version: "1.0.0" });
  const deadline = setTimeout(() => {
    console.error(`${preset.slug}: MCP handshake deadline exceeded`);
    void transport.close();
  }, 60_000);
  try {
    await client.connect(transport);
    const result = await client.listTools({}, { timeout: 30_000 });
    if (!result.tools.length) throw new Error("MCP server advertised no tools");
    console.log(
      `${preset.slug}: PASS (${result.tools.length} tools; handshake only)`,
    );
  } finally {
    clearTimeout(deadline);
    await client.close();
    await transport.close();
  }
}
