# Preview and tool-loop reliability

Scope: changes on `arena/cc530196-dyad`, 2026-10-26. This is not an exhaustive app, provider, plugin or desktop certification.

## Implemented

- Common built-in invocation boundary now has a tool-set-local loop guard. Three identical executed failures or successful mutation results for canonicalized identical arguments block the next unchanged attempt. Distinct successful mutations clear failed checks so a correction can be verified. Successful read-only polling is not blocked. History is capped at 64 digest entries and stores no argument/output plaintext. Existing root/subagent step budgets are unchanged.
- Builder profile adds `inspect_preview`, `control_preview`, `run_build`, `run_type_checks`, and `read_logs`. Existing tool availability/consent gates still apply. Browser interactions require consent by default; read-only modes exclude the state-changing control tool.
- Preview browser ownership is consolidated into a pending/live session registry: initial navigation, shared launches, stale-port cleanup, failed-launch cleanup, per-app operation queues, close fencing and four browser leases including closing launches. Concurrent stale-session replacement no longer overwrites/leaks another caller's new session.
- Preview navigation is restricted to the currently running app's HTTP(S) origin, including redirected document requests. Credential URLs, non-HTTP(S) destinations, popups and downloads are not exposed as controls. Contexts are isolated and service workers are blocked.
- Bounded DOM inspection provides visible main-document controls, precise selectors, accessible labels, state and bounds. It omits form values, raw HTML and storage. Ambiguous selectors fail rather than clicking an arbitrary first match.
- Consent-gated controls support navigate, click, fill/optional Enter submission, close and bounded responsive viewport sizes. No agent-supplied JavaScript evaluator is exposed.
- Screenshots encode real JPEG bytes as base64, then use the existing image-message attachment path rather than sending base64 as model text. Interpretation still requires a vision-capable selected provider/model. Oversized images return a limit notice, not a falsely claimed attachment.
- Restart/rebuild closes the old preview; Electron quit initiates best-effort cleanup. Console and page-error histories are bounded. Settling uses DOMContentLoaded plus 150 ms rather than a long network-idle wait. Full individual operations have a 30-second deadline, including otherwise unbounded page evaluation; timed-out sessions are discarded.

## Verification commands

Use Node 24, matching the project toolchain:

```sh
npm run qa:agent2
npx tsgo --noEmit -p scripts/qa/tsconfig.preview-loop.json
npm run presubmit
node scripts/qa/preview-driver-browser-smoke.mjs
npm run dev:renderer
node scripts/qa/browser-preview-smoke.mjs
```

The regression runner now includes all four new unit suites: guard, browser driver, DOM collector and preview-tool schema/dispatch/cancellation/image attachment. Driver tests include pending-launch closure, stale-port replacement races, resource caps and stuck-evaluation recovery. New runtime unit tests mock Playwright; the separate browser smoke uses **real Chromium and the production driver/DOM collector**, replacing only URL lookup and the Electron logger. It verifies rendered content, DOM, click, fill, ambiguous-selector denial, mobile viewport, JPEG bytes, console, same-origin restrictions, navigation and fresh-session cleanup against a local fixture.

Browser prerequisites: provision a compatible Playwright Chromium installation, or set `DYAD_PREVIEW_CHROMIUM_EXECUTABLE` for the driver smoke and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for the renderer smoke. The sandbox used an isolated external `@sparticuz/chromium@153.0.0` installation and its bundled NSS/NSPR libraries; no browser binaries or extra production dependencies were added to the repository. Renderer smoke allows a configurable `BROWSER_PREVIEW_TIMEOUT_MS` (60 seconds by default) for cold Vite compilation.

Final verified results:

| Check                                                                                                    | Result                                     | Sandbox log                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Expanded regression                                                                                      | **735 tests, 49 suites passed**            | `/home/user/preview-upgrade-regression.log` |
| Focused types, including changed registry/lifecycle/IPC host                                             | **Passed**                                 | `/home/user/preview-loop-types.log`         |
| Real Chromium production-driver smoke                                                                    | **Passed**                                 | `/home/user/preview-driver-browser.log`     |
| Live renderer: Home, Settings, Library, Templates, read-only mutation rejection, no uncaught page errors | **Passed**                                 | `/home/user/preview-renderer-smoke.log`     |
| Presubmit                                                                                                | **Passed, 0 errors / 5 existing warnings** | `/home/user/preview-presubmit.log`          |

The first broad run exposed a concurrent dynamic-import/mock resolution issue; single-flight lazy module loading corrected it. New concurrency tests also drove stale-session replacement fencing and pending-launch resource accounting. The first renderer smoke timed out at its original 30-second cold-start limit during concurrent QA; the warmed renderer subsequently passed with the configurable 60-second navigation allowance. These intermediate failures are not counted as successful runs.

## Explicit limitations

- This guard is a bounded repeated-outcome heuristic for built-ins, not a proof of semantic progress or all-loop termination. Changing arguments/errors, parallel already-started calls and dedicated MCP execution paths are not universally covered by it. Existing shared turn budgets remain essential. Oversized/unserializable arguments skip digest tracking. Legitimately repeated identical mutation results can also trip the guard.
- DOM inspection is **not unrestricted full-DOM control**: no iframe/shadow-tree enumeration, arbitrary JS, cookie/storage access or control of the Electron renderer itself. Hidden/inert controls are omitted; at most 3,000 candidate nodes are scanned and 50 controls returned. Page-rendered text/screenshots may still contain sensitive content; omitting field values from DOM serialization does not redact the whole page.
- Origin restrictions apply to document navigation, not all network traffic. Application assets/API calls may use other origins. This is not a general network or hostile-code security sandbox.
- Navigation/launch are individually bounded at 20 seconds; actions default to 10 seconds and an entire live-session operation to 30 seconds. No immediate in-flight abort guarantee is made; tool cancellation is checked before/after operations. Browser/context creation and OS teardown rely additionally on Playwright's behavior. Quit cleanup is best effort, not an awaited shutdown barrier.
- Four browser leases; console 200 entries × 2,000 characters, returned logs 8,000 characters; text 4,000; DOM 14,000; JPEG data URI 60,000. Limits can truncate evidence, and a fixed settle delay does not certify that asynchronous application state is stable.
- The fixture smoke is not live-provider or Electron E2E testing. The renderer development preview deliberately uses a read-only browser IPC adapter and does not run native desktop app lifecycle/backend tools.
- The existing `tool_definitions.test.ts` suite cannot collect in this ignore-scripts install because Electron's native distribution is absent. Its expanded builder allowlist was updated and is type-checked, but no runtime pass of that whole suite is claimed. No fake Electron installation was substituted.
