/** Reviewed browser QA commands; shared by the desktop catalog and smoke runner. */
export const BROWSER_MCP_PRESETS = [
  {
    slug: "playwright-local",
    name: "Playwright — Local Browser QA",
    description:
      "Browser interaction, accessibility snapshots and screenshots. Isolated headless profile; no Dyad service or provider key required. Requires a supported browser installation.",
    category: "Browser & QA",
    featured: true,
    transport: "stdio",
    command: "npx",
    args: [
      "-y",
      "@playwright/mcp@0.0.83",
      "--headless",
      "--isolated",
      "--block-service-workers",
    ],
  },
  {
    slug: "chrome-devtools-local",
    name: "Chrome DevTools — Local Diagnostics",
    description:
      "Console, network and performance diagnostics in an isolated headless Chrome profile. Usage statistics and external CrUX lookups disabled. Requires Chrome.",
    category: "Browser & QA",
    transport: "stdio",
    command: "npx",
    args: [
      "-y",
      "chrome-devtools-mcp@1.12.0",
      "--headless",
      "--isolated",
      "--no-usage-statistics",
      "--no-performance-crux",
    ],
  },
] as const;
