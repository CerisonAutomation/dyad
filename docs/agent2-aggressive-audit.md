# Agent2 reliability/performance audit — 2026-10-25

## Verified scope

This is a targeted code-and-regression audit, not a whole-application security certification or a measured global speedup. Run `npm run qa:agent2` with Node 24: it deduplicates the existing provider-only targets and the renderer, catalog, speech, goal-budget and public-reader targets into one repeatable gate.

Latest result: **644 tests passed / 40 files**. Targeted local-speech and public-reader TypeScript checks pass. `git diff --check` passes. Production dependency audit: **0 critical, 0 high, 2 moderate**; this is not the dev-inclusive audit.

## Fixed findings

| Finding | Change | Evidence |
| --- | --- | --- |
| Speech audio setup could throw outside the playback error handler | Catch malformed payloads, blob URL and player-constructor failures; clean up on failure | Local-speech client regression tests |
| Duplicate worker replies could create extra audio players/blob URLs | Accept one audio result per generation | Duplicate-result regression |
| A stale play promise could change state after another request started | Generation fence for callbacks and async playback completion | Pending-play replacement regression |
| Model/WASM memory remained retained during playback | Terminate inference worker as soon as the generated audio arrives | Worker termination assertion before playback completion; no heap-size claim |
| `play()` could remain pending after its watchdog was cleared | Keep startup watchdog until playback resolves; bound playback lifetime | Stalled-play test |
| Cleanup could dispatch media callbacks while still attached | Detach callbacks before pause/source cleanup; revoke blob URLs; stop on pagehide | Completion/cleanup tests |
| Warm model discovery stalled on remote refresh | Return a detached cached snapshot while a single refresh runs | Slow-refresh test with unresolved network promise |
| Caller mutation could poison cached pricing | Clone returned snapshots | Cache-isolation regression |
| Outages could preserve a free-pricing claim indefinitely | After 30 minutes retain model IDs but invalidate free-price eligibility | Prolonged-outage regression |
| Non-decimal price strings could coerce to zero | Accept decimal/scientific numeric syntax only; unknown pricing is not free | Malformed-price cases |
| Conflicting duplicate IDs could promote a paid/non-tool model | Conservatively combine conflicting pricing and capabilities | Both duplicate-order regressions |
| Unsuccessful discovery responses could leave unread bodies alive | Abort failed requests; retain bounded backoff | Error-response and deadline tests |
| Default builtin catalog implicitly contacted the former vendor | Require explicit catalog configuration; default returns bundled fallback metadata without network | Default-catalog no-fetch regression |
| Microphone buttons still linked to a paid upgrade | Replace upsell with an explicitly unavailable speech-to-text control | Home input regression and Chromium preview |
| Trial-only model-picker branch retained a purchase prompt | Remove purchase banner while retaining existing selection controls | Model-picker suite |

## Browser evidence

Chromium verified visible Home, Settings, Library and Templates navigation and read-only action rejection, with no uncaught page errors. A separate speech check deliberately blocked external model assets: failure was surfaced, Stop returned to idle and there were no uncaught page errors. Only Hugging Face asset-origin requests were observed during that speech check.

Vite still supplies read-only sample state, not real desktop settings or backend execution. Actual speech synthesis remains unverified because model weights cannot be downloaded in this environment. No audible-quality or offline-inference result is claimed.

## Remaining high-priority gaps

1. **Commercial migration is incomplete.** Additional promotional/error/quota paths remain, including `PromoMessage.tsx`, `FreeAgentQuotaBanner.tsx`, `ChatErrorBox.tsx` and legacy quota hooks. They need behavioral conversion, not blind string replacement or removal of provider limits.
2. **Speech input is separate from speech output.** `pro_handlers.ts` still references the legacy engine transcription implementation. The local read-aloud feature does not convert microphone transcription.
3. **Image generation remains a migration target.** The local-agent image tool is not established as a working BYOK image-generation path.
4. **Discovery is not universal.** OpenRouter discovery is dynamic. Other providers/custom endpoints still need provider-specific discovery adapters, permission and credential handling, capability validation and freshness policies. Bundled metadata remains a fallback, not evidence that models are currently available.
5. **Native runtime coverage is blocked.** The full local-agent-handler suite cannot collect in this sandbox because Electron/native PTY binaries are missing. Two exploratory test-only mocks did not resolve the dependency chain and were removed; no native runtime success is claimed. Focused goal-budget tests do not replace that suite.
6. **DSH/upstream comparison is unfinished.** The official DSH source and a community index were obtained and some official patterns reviewed. Thousands of community listings are not source-reviewed or vetted. No complete upstream-Dyad feature-parity claim is supported.
7. **No full build/typecheck/security certification.** The targeted checks do not prove the entire application compiles, all integrations authenticate, live inference succeeds or all cloud/commercial paths have been removed.

## Next acceptance gates

- Convert remaining commercial UI and source admission together, retaining explicit provider/account selection and actual provider quota errors.
- Add credential-scoped provider adapters and model capability/freshness admission before extending automatic routing.
- Provision trusted Electron/native dependencies and run full desktop/local-agent tests.
- Verify actual downloaded local speech synthesis and cancellation on supported browsers/devices.
- Complete upstream feature inventory and source/license/security review of shortlisted DSH plugins before adopting code.
