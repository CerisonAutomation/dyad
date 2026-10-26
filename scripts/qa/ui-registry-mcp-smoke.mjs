import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const preset = JSON.parse(
  fs.readFileSync(
    new URL("../../shared/ui-registry-presets.json", import.meta.url),
  ),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    path.join(root, "node_modules/shadcn/dist/index.js"),
    "mcp",
    "--cwd",
    root,
  ],
  cwd: root,
  env: Object.fromEntries(
    ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  ),
  stderr: "pipe",
});
const client = new Client({ name: "agent2-shadcn-qa", version: "1.0.0" });
let stderr = "";
const deadline = setTimeout(() => {
  console.error("shadcn MCP smoke deadline exceeded");
  void transport.close();
}, 25000);
try {
  await client.connect(transport);
  transport.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const listed = await client.listTools({}, { timeout: 10000 });
  for (const name of [
    "get_project_registries",
    "search_items_in_registries",
    "view_items_in_registries",
    "get_add_command_for_items",
    "get_audit_checklist",
  ])
    assert(
      listed.tools.some((tool) => tool.name === name),
      `${name} present`,
    );
  const registries = await client.callTool(
    { name: "get_project_registries", arguments: {} },
    undefined,
    { timeout: 10000 },
  );
  assert(!registries.isError, JSON.stringify(registries));
  const text = JSON.stringify(registries.content);
  for (const entry of preset.registries)
    for (const name of [entry.name, ...entry.aliases])
      assert(text.includes(name), `${name} configured`);
  const items = [
    "@shadcn/button",
    "@coss/accordion",
    "@magicui/marquee",
    "@kibo-ui/kanban",
    "@aceternity/bento-grid",
    "@dashboardblocks/kpi-01",
  ];
  const command = await client.callTool(
    { name: "get_add_command_for_items", arguments: { items } },
    undefined,
    { timeout: 10000 },
  );
  assert(!command.isError, JSON.stringify(command));
  for (const item of items)
    assert(JSON.stringify(command.content).includes(item));
  const healthy = await client.callTool(
    { name: "get_audit_checklist", arguments: {} },
    undefined,
    { timeout: 5000 },
  );
  assert(!healthy.isError);
  console.log(
    `PASS real shadcn ${preset.cliVersion} MCP initialize/tools/list, six-source project configuration, six-source install-command generation and healthy follow-up. No registry source downloaded or component installed by this smoke.`,
  );
} catch (error) {
  if (stderr) console.error(stderr);
  throw error;
} finally {
  clearTimeout(deadline);
  await client.close();
  await transport.close();
}
