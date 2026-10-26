# Built-in tool capability audit — 2026-10-26

## Scope and results

All **59 built-in registered tools** were inventoried from the TypeScript registry. Registry/schema/consent/read-only policy contracts were checked for each tool in synthetic API-key and subscription contexts. This is not a claim that all external services, credentials, native desktop functions or platform targets were exercised.

- Full focused tool suite: **1,122 passed, 2 skipped, 73 files**. The skips are Windows-only shell-process cases on Linux. Includes real Git/ripgrep subprocesses and SQLite-backed tests. Electron-dependent imports use the repository's explicit test mock, not a desktop runtime.
- Pre-merge separate Agent2 regression: **806 passed, 55 files**. Counts overlap; do not add them as unique coverage.
- Real local MCP stdio: initialize, tools/list, valid tools/call, invalid input rejection and teardown passed against a deliberately minimal local fixture. No user credentials forwarded. This does not certify remote MCP servers.
- Real Chromium preview driver: DOM, click/fill, viewport, JPEG screenshot, console, external-navigation rejection and fresh-session cleanup passed.
- Existing app renderer smoke: visible rendering/navigation/read-only action rejection, no uncaught page errors passed.
- Focused source/test types and separate Forge/maker/signing configuration types passed.
- npm audit: **zero vulnerabilities**, all severities, after adding the missing direct node-fetch runtime dependency.

## Fixes in this batch

1. Builder can now request public documentation through web_fetch/web_crawl with existing consent, SSRF, cancellation and output limits intact.
2. Legacy Engine-only tools cannot be discovered or invoked by API-key/subscription turns, even with a stale commercial entitlement.
3. Preview control exports an object-shaped provider schema; action-specific requirements remain enforced by host validation and dispatch. Invalid inputs cannot reach the browser.
4. node-fetch is now a declared runtime dependency rather than an accidental transitive dependency.
5. Forge 8/Packager hooks use their actual async object-argument API. AppImage platform and Windows signing types were updated, retaining SHA-256 signing across Packager/Squirrel dependency versions.
6. Development ripgrep can use an explicitly configured absolute executable; packaged applications ignore this override. The audit uses installed host Git via Dugite's supported environment options and installed host ripgrep, not invented binaries.
7. Stale subagent tests now verify provider-selected models and chat-scoped inference instead of assuming a hardcoded helper model or a Pro requirement. Production provider/consent checks were not bypassed to make tests pass.

8. Both image entry points now use explicit provider configuration rather than the legacy Engine. The media dialog no longer checks a commercial budget or displays a Pro-only lock. GPT uses subscription OAuth only; saving that backend selects subscription chat mode. Tests include a real local HTTP protocol fixture, real tiny JPEG/WebP files, no-API-fallback cases, streaming limits/cancellation, atomic saves, app lifecycle coordination and managed-directory symlink rejection.

## Evidence files

- [inventory.json](inventory.json): exact registered names, consent/mutation flags, gates, fixture-mode exposure. Booleans describe only the documented synthetic contexts; unavailable provider/project/plugin capabilities are not necessarily broken.
- [sources.json](sources.json): AST-resolved registration/source links and sibling test discovery. A missing sibling test is not proof of no tests elsewhere; presence is not live execution proof.

These JSON files are snapshots from this execution, not live user configuration. Regenerate the underlying evidence with `npm run qa:tool-audit`; output goes to ignored `node_modules/.cache/tool-audit/` unless AGENT2_TOOL_AUDIT_DIR is explicitly set. The runner fails on unresolved registrations or failing tests. Use the repository-supported Node version; native Node modules must be built for that runtime. On Linux the audit expects installed git and rg and supplies their supported development configuration to the child test process. It does not install, deploy or connect user accounts.

Run the local MCP protocol fixture with `npm run qa:mcp-protocol`. No Inspector/server download is required. The research basis for separately testing list and call operations is the official MCP Inspector CLI: https://github.com/modelcontextprotocol/inspector .

## Still not working or not certified

- Image generation now has shared Cloudflare, ChatGPT/Codex OAuth and other/local OpenAI-compatible adapters. GPT image API configuration is blocked: GPT uses only the OAuth subscription route, without API-key fallback. The native Codex image transport is experimental and has fixture coverage, not authenticated live certification. See [image-generation.md](image-generation.md).
- Web search currently has explicit OpenAI/Anthropic API adapters. Other providers and subscription-backed search are not silently billed through a different source.
- Actual Electron runtime installation/launch remains blocked locally by its release-asset download host. The desktop CI workflow exists locally but has not been executed; no desktop pass is claimed.
- Real provider authentication, external MCP servers, connected database administration and deployment were not executed without their required context/credentials/authorization.
- Framework guides do not install Rust/Flutter SDKs or add native framework build/preview support.
- Packaged Git/ripgrep distribution, actual signing, cross-platform builds and complete application-wide production verification remain separate checks.
