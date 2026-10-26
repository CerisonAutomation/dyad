import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Uses the installed SDK, not an implicitly downloaded Inspector/server. No
// model keys, cookies, or account settings are forwarded to the child process.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./mcp-fixture-server.mjs", import.meta.url))],
  env: Object.fromEntries(
    ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  ),
  stderr: "pipe",
});
const client = new Client({ name: "agent2-protocol-qa", version: "1.0.0" });
const deadline = setTimeout(() => {
  console.error("MCP smoke deadline exceeded");
  void transport.close();
}, 10_000);
try {
  await client.connect(transport);
  const listed = await client.listTools({}, { timeout: 5000 });
  assert.equal(listed.tools.length, 1);
  assert.equal(listed.tools[0].name, "qa_echo");
  const result = await client.callTool(
    { name: "qa_echo", arguments: { text: "protocol-working" } },
    undefined,
    { timeout: 5000 },
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content, [
    { type: "text", text: "protocol-working" },
  ]);
  let rejected = false;
  try {
    const invalid = await client.callTool(
      { name: "qa_echo", arguments: { text: "x".repeat(129) } },
      undefined,
      { timeout: 5000 },
    );
    rejected = invalid.isError === true;
  } catch {
    rejected = true;
  }
  assert(rejected, "server must reject out-of-schema input");
  console.log(
    "PASS: real MCP stdio initialize, tools/list, tools/call, invalid-argument rejection, teardown (local fixture, not external service certification)",
  );
} finally {
  clearTimeout(deadline);
  await client.close();
  await transport.close();
}
