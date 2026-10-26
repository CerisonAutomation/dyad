# Six-source UI registry integration

## Installed/configured

- Official `shadcn` CLI **4.22.1**, exact-pinned as a development dependency; package-lock updated.
- Project-local Claude Code `.mcp.json`, pinned to the same version. Official `mcp init --client claude` completed using Node 24 with lifecycle scripts disabled.
- Checkout `components.json` configured for six sources, including shadcn's implicit built-in registry. No existing UI primitives were replaced and no bulk component catalog was copied.
- **shadcn — UI Registries** added to Dyad's built-in MCP catalog, independent of the legacy commercial catalog. Its required `DYAD_MCP_PROJECT_DIR` input sets the stdio server's actual working directory; missing or invalid targeting fails before launch. Existing MCP servers retain their cwd behavior unless explicitly configured.
- `ui-registries` added to the builder's on-demand guide registry and relevant React UI prompt routing. Detailed licensing, source-review, permissions, compatibility and verification instructions are in `src/prompts/guides/ui-registries.md`.

A source-controlled `.mcp.json` does not create or activate a server in Dyad's database. In desktop Dyad, add **shadcn — UI Registries** from the MCP/plugin catalog and enter the absolute target app folder. A global MCP connection is explicitly scoped and does not silently switch folders when chat tabs change. Desktop activation has not been verified in this sandbox.

## Corrected baseline

| Source | Current namespace | Notes |
| --- | --- | --- |
| shadcn/ui | `@shadcn` | Built in; an explicit override in components.json is rejected by this CLI. |
| Origin successor, coss UI | `@coss` | Origin site/old registry redirect to coss. `@origin` is explicitly configured as a successor alias, not the original inventory. Base UI compatibility needs review. |
| Magic UI | `@magicui` | Uses the official directory URL; requests redirect to JSON. |
| Kibo | `@kibo-ui` | Official namespace; `@kibo` retained as a compatibility alias. |
| Aceternity | `@aceternity` | Official `/registry/{name}.json` route. |
| Dashboardblocks | `@dashboardblocks` | Uses the documented `/r/radix/{name}.json` route for this legacy Radix/new-york checkout; modern projects can use the directory's `{style}` route. |

Do not assume all blocks are free, or that third-party inventory counts are accurate. No paid access was purchased, no provider credentials were added, and no secret is needed for the configured public baseline.

## Commands

Use the repository-supported Node 24 runtime:

```sh
npm run ui:registries -- --check
npm run ui:registries -- --cwd /absolute/path/to/initialized-react-app
npm run ui:mcp -- --cwd /absolute/path/to/initialized-react-app
npm run qa:ui-registries
```

The setup command preserves existing aliases, styles, CSS, custom registry configurations and credentials. Conflicting namespaces are retained and reported, not silently replaced. It refuses reserved `@shadcn` overrides and does not print custom registry headers/tokens. It does not initialize a framework, install component code or run registry scripts. Builder edits/installations still use normal mutation consent/read-only checks.

## Executed verification

- **113 tests passed across 7 files**: configuration merge/idempotence/check-only behavior, namespace compatibility, pin consistency, secret-safe CLI output, MCP catalog schema, directory validation, actual manager cwd propagation, guide loading and prompt/snapshot routing.
- Real installed shadcn MCP: initialize, tools/list, get_project_registries, six-source add-command generation, healthy follow-up and teardown **passed**. This verifies the actual server protocol/local configuration, not remote component installation.
- Bounded source/test type check **passed**.
- Real Chromium renderer navigation/read-only smoke **passed**, without uncaught page errors.
- npm audit: **zero vulnerabilities in all severities** after installation. git diff --check passed.
- Research fetches reached representative public registry items: shadcn button, coss accordion, Magic UI marquee, Kibo Kanban, Aceternity bento-grid and Dashboardblocks Radix kpi-01. Research fetcher reachability is distinct from the app process's network access; sanitized research output was not copied into TSX files.
- A real CLI `view @aceternity/bento-grid` attempt **failed** because the sandbox disconnected TLS before handshake. No repeated unchanged attempt or network-policy bypass was made. Live CLI/MCP component downloads, installation from all six public endpoints, rendering of those newly downloaded components and native Electron activation are **not certified**.

Authoritative sources: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/directory.json ; https://ui.shadcn.com/docs/directory ; https://coss.com/ui ; https://ui.aceternity.com/docs/cli ; https://www.dashboardblocks.com/docs/compatibility .
