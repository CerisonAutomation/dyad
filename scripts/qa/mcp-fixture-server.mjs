// Local protocol fixture only; no filesystem, browser or external API capability.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "agent2-qa-fixture", version: "1.0.0" });
server.registerTool(
  "qa_echo",
  {
    description: "Echo bounded non-sensitive fixture text",
    inputSchema: { text: z.string().min(1).max(128) },
  },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
);
await server.connect(new StdioServerTransport());
