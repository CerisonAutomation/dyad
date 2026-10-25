# Browser QA and provider-only Agent v2 audit

Date: 2026-10-25. Repository: CerisonAutomation/dyad, branch arena/3b94ddb6-dyad.

## Executive summary

This is a targeted cross-cutting audit and implementation, **not** a claim that every line, model, tool, deployment or native Electron path has been verified. The checkout contains 2,382 tracked files under `src`, including 201 under `src/pro`. Inspection concentrated on model/source resolution, auxiliary inference, agent eligibility, MCP setup, HTTP boundaries and streaming failover.

Implemented: local browser MCP catalog, working MCP handshake automation, pinned Replica skills, default-deny application guards for known Dyad-operated endpoints, selected-model auxiliary routing for explicit API/subscription modes, native Agent v2 capability eligibility, and a streaming integrity fix. Unsupported engine features fail closed rather than being disguised as provider-native implementations.

## 1. GitHub research: recommended browser stack

These recommendations are based on the official repositories, README/configuration documentation and actual pinned CLI help, not a comparative performance benchmark.

| Tool                                                                         | Role and decision                                                                                                                         | Trade-off                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)      | Primary agent browser: interaction, accessibility snapshots and screenshots. Added local stdio preset pinned to `@playwright/mcp@0.0.83`. | Requires a supported installed browser. MCP interaction is not a deterministic regression test. Origin filters explicitly are not a security boundary, including redirects. |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Complementary console/network/performance diagnostics. Added `chrome-devtools-mcp@1.12.0`.                                                | Requires Chrome. Usage statistics and external CrUX lookups are on by default upstream, so both are explicitly disabled in our preset.                                      |
| [Vercel agent-browser](https://github.com/vercel-labs/agent-browser)         | Useful CLI alternative for shell-driven agents. Reviewed, not installed as a third competing browser runtime.                             | Requires a native CLI/browser install; overlaps the selected MCPs and adds packaging/maintenance surface.                                                                   |
| [Browserbase Stagehand](https://github.com/browserbase/stagehand)            | Useful SDK for programmatic browser agents and structured extraction. Reviewed, not made a dependency.                                    | Adds a separate agent/inference layer. We retain Dyad's selected provider and existing orchestration instead of introducing another default cloud or billing source.        |
| [Playwright Test](https://github.com/microsoft/playwright)                   | Keep the existing Electron E2E suite as the release authority.                                                                            | Desktop packaging/native dependencies are required; a standalone browser MCP cannot prove Electron integration works.                                                       |

`shared/browser_mcp_presets.ts` is shared by the desktop catalog and the smoke runner. Both servers use headless, isolated profiles; neither attaches to a logged-in browser nor disables the Chromium sandbox. Playwright blocks service workers. Catalog entries are available offline and cannot be overridden by a remote catalog entry with the same slug.

**Not automatically enabled:** adding a catalog entry does not launch a server inside the user's persistent Dyad profile. Existing Add Plugin/setup and consent remain in place. The development smoke runner started the pinned servers, listed tools, and closed them; it did not navigate, authenticate, execute model inference or touch a production service.

### Verified MCP results

- Playwright MCP: successful real stdio handshake, **25 tools advertised**.
- Chrome DevTools MCP: successful real stdio handshake, **32 tools advertised**.
- The runner forwards a small environment allowlist, not model keys or cloud credentials.
- These are startup/discovery checks, **not** successful screenshots, accessibility scans, performance traces or navigation tests.
- Package versions are pinned; npx transitive dependency resolution is not a fully vendored, offline-reproducible browser toolchain.

## 2. Replica skills: located and installed

Upstream: [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill), MIT.
Pinned commit: `77c9436fb3d18c3d58169efb8caf4fe906b0dc51`.

Installed eleven skills under `.claude/skills/replica-*`, including the recon prerequisite and all ten requested commands:

`/replica-recon → /replica-architect → /replica-design → /replica-build → /replica-backend → /replica-test → /replica-diff → /replica-entrepreneur → /replica-brand → /replica-launch → /replica-deploy`

The existing `.agents/skills` symlink points to `.claude/skills`, so the pack is also discoverable by compatible repository-scoped agents. New sessions may be needed for skill discovery. This installation does **not** insert prompts into Dyad's database-backed in-app slash-prompt library or package all helper scripts into a distributed Electron binary.

All 27 vendored files have SHA-256 entries in `replica-provenance.json`; the MIT notice is preserved in `REPLICA-LICENSE`. The Python helpers were inspected for process/network execution; they are local file/data utilities. Upstream's 57 Python tests passed on the same pinned checkout. `npm run qa:skills` verifies the installed files match that checkout without executing the helpers.

### Workflow disposition

| Stage        | Applied here / boundary                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Recon        | Inspected official browser/router projects and our provider/agent paths. No private application was scraped.                           |
| Architect    | Local MCPs + accepted-source inference + default-deny app network boundary. Preserve Electron, React, existing IPC and SQLite.         |
| Design       | Offline catalog entries describe capabilities/prerequisites. No untested cosmetic redesign.                                            |
| Build        | Browser presets, network guards, routing fixes, tests and QA commands implemented.                                                     |
| Backend      | Reused existing APIs/subscription adapters; did not add an obligatory gateway.                                                         |
| Test         | Focused regression suite, isolated MCP handshakes and pinned skill tests executed. Native/visual validation is still a release gate.   |
| Diff         | Source diffs, format/lint checks and a standalone type-check; no fabricated screenshot-parity score.                                   |
| Entrepreneur | Reduces unwanted vendor coupling and makes billing boundaries explicit. No invented revenue or user-research metrics.                  |
| Brand        | Existing project/license notices retained. No confusing replica of third-party brands/assets.                                          |
| Launch       | Not executed: product positioning, legal review and native release validation are incomplete.                                          |
| Deploy       | Not executed: no release, domain, account, production database or payment changes. The skill itself requires explicit launch approval. |

## 3. FreeLLMAPI patterns and similar agent projects

Inspected [FreeLLMAPI README](https://github.com/tashfeenahmed/freellmapi), [streaming architecture](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/architecture/03-streaming-pipeline.md), [failover architecture](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/architecture/04-degraded-mode-and-failover.md), and [shared fallback loop source](https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/fallback-loop.ts).

Useful patterns: turn integrity rather than mere HTTP success, bounded retries, respect Retry-After, source/capability-aware routing, no replay after committed output, cooldowns and observable failure attribution. Our existing fallback model already implements bounded attempts, Retry-After, cancellation-aware retry waits and no fallback after content. Those were tested, not blindly rewritten.

**New streaming fix:** metadata-only EOF previously closed as a successful empty response. It now retries within the existing bounded recovery policy before content has committed. A regression test also proves tool-input events prevent replay/failover after a tool call has begun.

**Deliberately not imported:** its hosted model feed/premium catalog, key-pooling assumptions, automatic cross-provider billing changes, or a new required gateway. A user-selected provider must not be replaced behind their back. No provider quotas or subscription access restrictions are bypassed.

Additional GitHub comparators: [OpenHands](https://github.com/All-Hands-AI/OpenHands) for development-agent orchestration, [Roo Code](https://github.com/RooCodeInc/Roo-Code) for agent roles, and agent-browser/Stagehand above for browser-agent interfaces. Their descriptions/licenses were checked; this is not a deep code audit or a performance ranking of those projects, and their source was not copied into Dyad.

## 4. Reproduced issues and changes

| Finding                                                         | Evidence and fix                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API helpers silently switched to Pro                            | `getAuxiliarySettings()` explicitly changed `api-key` to `pro`. Removed that override.                                                                                                                                                                                                                                                       |
| Fixed auxiliary models ignored current selection                | Exploration helpers, persona settings, compaction and tool safety review selected fixed engine/helper models. Explicit API/subscription modes now inherit the accepted model/provider/effort; standalone auxiliary requests also use the stored chat model in subscription mode. Legacy non-explicit settings retain compatibility behavior. |
| Native agent capability conflated with paid entitlement         | Added explicit-provider eligibility for Agent v2, subagent tools/manager, code/history exploration, auto review, reviewed host shell and user-enabled MCP safety review. Read-only/Plan, child-tool, mutation tracking, opt-in and consent restrictions remain.                                                                              |
| Direct agent turns consumed Dyad free quota                     | `isBasicAgentMode()` now excludes explicit API/subscription selections with concrete providers. Auto aliases are not blindly treated as configured direct providers.                                                                                                                                                                         |
| Known Dyad HTTP endpoints reachable through multiple transports | Added startup global-fetch policy with redirect-hop checks, legacy node-fetch boundary, Chromium session request rules, and an engine URL check. Explicit API/subscription contexts also reject engineFetch before networking.                                                                                                               |
| Offline MCP catalog empty                                       | Bundled local browser entries and reused the existing catalog/setup contracts.                                                                                                                                                                                                                                                               |
| Metadata-only stream reported success                           | Fixed in `fallback_ai_model.ts`, with tests for empty EOF and committed tool-input non-replay.                                                                                                                                                                                                                                               |
| Build-blocking duplicate function                               | Base commit contains two identical `boundOutputForEstimate` declarations in `token_utils.ts`. Esbuild reproduced the duplicate-symbol failure. Removed the duplicate; 17 token utility tests pass.                                                                                                                                           |

### Cloud policy: what it does and does not promise

Default behavior blocks `dyad.sh`, its subdomains and the known legacy Dyad Cloud Run engine/image-upload hosts. A saved Pro key does not enable access. The only compatibility escape hatch is the explicit process environment `DYAD_ALLOW_CLOUD=true`.

- Installed before importing the main runtime; Squirrel install/update hooks still exit without loading the runtime or policy.
- Global fetch validates every automatically followed redirect hop and strips common credentials across origins.
- Legacy node-fetch API/signed-upload calls reject cloud URLs and do not automatically follow redirects in provider-only mode. Callers must use canonical URLs; explicit manual redirects can be inspected without following.
- Session rules deny matching renderer/Chromium requests. Engine URL validation rejects the default cloud endpoint early; an explicitly configured non-Dyad/local engine URL remains possible.
- Network denial is **not** a provider-native conversion of image generation, crawl, voice transcription, cloud sandboxing, hosted help, OAuth refresh brokers or every theme feature. Some are intentionally unavailable until direct adapters exist.
- This is **not an OS firewall**. Arbitrary shell commands, MCP subprocesses, external browsers, third-party SDK low-level sockets and unknown future hostnames are not proven contained. Do not describe it as a packet-level guarantee of zero cloud traffic. Telemetry hosted on third-party domains remains governed by the app's telemetry settings.
- No traffic capture or packaged desktop validation was available in this run. Those are necessary before claiming complete egress isolation.

## 5. Repeatable QA

Use Node 24 (the repository requires `>=24 <26`):

```sh
npm ci
npm run qa:skills
npm run qa:provider-only
npm run qa:browser-mcp
```

For one browser server: `npm run qa:browser-mcp -- playwright-local` or `-- chrome-devtools-local`.

The browser runner uses npx to obtain the pinned MCP packages; it needs registry access but no model credentials. Browser navigation requires an appropriate browser installation separately. Do not attach a personal logged-in Chrome profile or expose a debugging port to the public internet.

`.github/workflows/provider-only-qa.yml` runs contracts and skill integrity on relevant pull requests, weekly and manually. External MCP programs run only on scheduled/manual workflows, not untrusted PR jobs. Workflow permissions are read-only; no production or model secrets are requested.

### Observed validation

- `qa:provider-only`: **267 tests passed across 16 files**.
- Additional legacy billing/pro handler unit tests: **40 passed** (two suites).
- Both pinned MCP stdio handshakes passed (25 and 32 advertised tools).
- Skill integrity: 11 stages / 27 files verified; upstream Python utility tests: **57 passed**.
- Standalone strict type-check of the network policy and browser presets passed.
- Source bundling/syntax check of bootstrap, model client, subagent manager and local-agent handler passed with external dependencies and the Markdown loader. This is not a production Electron build.
- Full application type-check was killed by the environment, including a memory-constrained retry. No full type-check pass is claimed.
- Broader native suites could not fully run: Electron binary, Linux node-pty and better-sqlite3 native bindings are absent after the script-free dependency install. The external-model-admission suite is also blocked by Electron loading. No desktop E2E or live model credentials were used.

## 6. Remaining release blockers / next work

1. Run native dependency install/build, full `npm run ts`, model-client/subagent/history integration suites, and packaged Electron E2E on a supported host. Validate tool exposure and current-model inheritance through actual IPC/streamed turns.
2. Capture app and child-process traffic during API and subscription flows; add OS/container egress controls if a strict zero-Dyad-network guarantee is required.
3. Replace every remaining engine-only adapter with explicit per-provider capability implementations. Prefer an actionable unavailable state over a fake unlock.
4. Remove/migrate stale Pro settings, purchase/deep-link flows, upgrade prompts and theme/image/voice/cloud UI. The current patch does not claim those surfaces are all converted.
5. Add real browser navigation, screenshot, keyboard, axe accessibility, console/network and performance assertions to representative app flows. MCP availability alone is not QA success.
6. Add budgeted circuit breakers and model health data only within user-authorized providers. Keep failed/cancelled tool calls from being replayed and never migrate billing silently.
7. Review licensing before a competing commercial distribution: the root project is MIT but `src/pro/LICENSE` contains FSL-1.1-ALv2 terms. Those notices were not removed or relicensed. Seek legal advice for distribution plans.
