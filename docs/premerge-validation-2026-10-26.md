# Pre-merge validation — 2026-10-26

Branch: arena/cc530196-dyad. Before committing, origin/main was fetched and identical to the branch base (0 commits ahead/behind); all session work was in the working tree.

## Executed

- Tool capability audit: 73 files, **1,122 passed, 2 platform skips**. First concurrent run exposed a same-tick descendant-reaping assumption in the cancellation test. Changed the assertion to require eventual process disappearance within 3 seconds; full audit then passed. Production process-killing behavior was not weakened.
- Agent2 regression: 55 files, **806 passed**. Counts overlap the tool audit.
- UI registry QA: **113 passed**, real official shadcn MCP initialization/list/configuration/add-command generation/follow-up/teardown passed.
- Browser preview adapter/catalog cards: **54 passed** (overlaps earlier focused suites).
- Real local MCP protocol fixture passed.
- Bounded source/test and Forge/toolchain type checks passed. Not a full application-wide type/build certificate.
- Real Chromium renderer smoke passed Settings, Library, Templates, Plugins and Apps. Plugins supports catalog browse/search with empty connections, disabled desktop mutations and no MCP error toasts.
- npm audit: zero advisories at all severities.
- git diff --check passed.

## Dependency currency

`npm outdated --json` reports 93 direct entries differing from registry wanted/latest versions. This includes major-version changes and exact-pinned tools. A blanket dependency refresh was deliberately not mixed into this merge: the committed lockfile is the tested dependency set, not a claim that all packages are the newest release. The registry scan is advisory and does not supersede compatibility, security review or tested pins.

## Remaining limitations

Native Electron installation/launch and packaged distribution remain unverified locally because of download/system-library restrictions. The desktop smoke workflow is included for GitHub execution; a local pass is not claimed. Live authenticated provider/image generation and remote registry component downloads are not certified. Project-local .mcp.json does not create a running desktop database connection. See docs/tool-audit/README.md and docs/ui-registries.md for setup and scope.
