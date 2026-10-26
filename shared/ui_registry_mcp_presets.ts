/** Reviewed UI registry command metadata. No desktop imports or runtime actions. */
export const UI_REGISTRY_MCP_PRESETS = [
  {
    slug: "shadcn-ui-registry",
    name: "shadcn — UI Registries",
    description:
      "Official shadcn MCP for six UI sources: shadcn, coss (Origin successor), Magic UI, Kibo, Aceternity and Dashboardblocks. Set the absolute target app folder; configure its components.json first. Registry access requires internet; premium content is not unlocked.",
    category: "UI & Design",
    featured: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "shadcn@4.22.1", "mcp"],
    inputs: [
      {
        kind: "env",
        name: "DYAD_MCP_PROJECT_DIR",
        label: "Absolute target app directory (contains components.json)",
      },
    ],
  },
] as const;
