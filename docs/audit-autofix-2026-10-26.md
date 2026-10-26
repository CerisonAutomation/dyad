# Cross-area audit and autofix — 2026-10-26

This is an executed, scoped engineering audit, not 100 independent expert reviews, exhaustive coverage or a production certification. Existing dirty changes were preserved on `arena/cc530196-dyad`.

## Review lenses and concrete changes

| Area                               | Finding / action                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider security                  | OpenCode fetch enforcement previously relied only on the configured base URL. Added final request-destination validation, fail-closed rejection of other origins/paths and `redirect: error` so automatic redirects cannot forward credentials or conversation headers.                                                                                            |
| Privacy and routing                | Verified stable conversation-scoped UUIDs, unrelated-origin isolation, preserved authentication/body/signal, and rejection of caller attempts to override the routing ID. User-Agent enforcement is now idempotent.                                                                                                                                                |
| Preview lifecycle                  | A closed/crashed page could hold a browser lease until another inspection of that same app. Added close-event ownership cleanup, fenced to the matching session generation, with a regression test.                                                                                                                                                                |
| Commercial UX and unnecessary work | Replaced ChatErrorBox's legacy credit/membership upsells and three quota/budget hook dependencies with provider-based recovery. Ordinary provider diagnostics remain visible. Recovery is explicit, not an automatic retry; changing chat mode is not presented as a way to reset provider limits. Start-new-chat no longer depends on an application entitlement. |
| Accessibility                      | Chat error is a live alert; dismissal is a labeled, keyboard-accessible button. Diagnostic links remain user-initiated.                                                                                                                                                                                                                                            |
| Dependency security                | Updated Electron 40.0.0 → 40.10.6, Happy DOM 17.x → 21.0.4, Vitest/UI 3.x → 4.1.12, and scoped formatter-worker override to tinypool 2.2.0. Lockfile regenerated; install scripts intentionally not run in this sandbox.                                                                                                                                           |
| Test isolation                     | Vitest 4 exposed leaked mock history/restoration assumptions in engine_fetch tests, including policy tests outside the nested describe. Added file-wide cleanup and call-history isolation without weakening cancellation/no-fetch policy assertions.                                                                                                              |
| Verification                       | Expanded the focused type-check entry points to include the changed chat component and new header tests; ran real Chromium driver and renderer smoke tests as well as the regression suite.                                                                                                                                                                        |

## Dependency findings — not an all-clear

`npm audit` affected-package entry counts:

| Severity | Before | After |
| -------- | -----: | ----: |
| Critical |      6 |     1 |
| High     |     28 |    28 |
| Moderate |     10 |     9 |
| Low      |      3 |     3 |
| Total    |     47 |    41 |

The remaining critical entry is **tar 6.2.1 in the packaging/native-build dependency tree**. Further high findings include Electron and packaging/archive dependencies. Updating Electron within its existing major does not fix every upstream advisory. Major Electron/Forge migrations or cross-major transitive overrides require native rebuilding and cross-platform installer validation; these were not blindly forced or marked resolved. Tooling exposure is not the same as confirmed application exploitability, but these are real unresolved advisories.

Audit JSON/logs remain outside Git:

- `/home/user/autofix-dependency-audit.json`
- `/home/user/autofix-dependency-final.json`
- `/home/user/autofix-security-upgrade.log`

The initial npm 10 installer hit an Arborist peer-resolution exception. npm 11 completed the explicit version updates. The scoped formatter override was separately installed and exercised by formatting/presubmit.

## Remaining audit work

- Static search still finds legacy commercial branches in ProviderSettingsPage/Header, FreeAgentQuotaBanner, PreviewIframe and subscription-status components. Their reachability/removal has **not** been exhaustively established. ChatErrorBox is fixed; this is not a claim that the entire app's migration is complete.
- Dedicated MCP paths and already-started parallel calls are not universally covered by the new repeated-outcome guard; existing shared runtime budgets remain necessary.
- No native Electron desktop E2E, platform installer build, authenticated live OpenCode request or universal provider/tool integration certification was performed.
- Browser DOM/control limitations and operation cancellation limits remain as documented in `preview-loop-verification.md`.

## Verification

Final verified results:

- **751 tests / 50 suites passed** on Vitest 4.1.12 and Happy DOM 21.0.4 (`/home/user/autofix-regression-final.log`).
- Focused types passed (`/home/user/autofix-types.log`).
- Presubmit passed, 0 errors / 5 warnings (`/home/user/autofix-presubmit.log`).
- Real Chromium production-driver smoke passed after the final lifecycle change (`/home/user/autofix-browser-driver.log`).
- Live renderer Home/Settings/Library/Templates navigation, read-only mutation rejection and no uncaught page errors passed after dependency updates (`/home/user/autofix-renderer.log`).
- `git diff --check` passed.

A broad regression run initially exposed the Vitest 4 mock-history failures; those were fixed rather than suppressing the assertions. Full native/installer validation and the unresolved dependency findings above remain separate blockers to an all-clear.
