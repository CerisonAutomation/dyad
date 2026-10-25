# Reliability verification — 2026-10-26

## Changes made

- Prompt improvement now aborts the caller's wait during model resolution, client setup, generation and finish metadata even if the underlying promise ignores cancellation. Late results cannot advance the cancelled workflow.
- The composer IPC action has a single 90-second end-to-end deadline, including settings lookup, and always clears its timer, window listener and active-request slot. Cancellation and timeout permit an explicit fresh attempt without restarting the app. No automatic paid retries, provider changes, tool execution or deployment were added.
- Added regression cases for hung settings, hung refiner, hung client setup, hung provider generation, cancellation, late results and admission-slot recovery.
- Reconciled the local session snapshot with the existing PR history without force-pushing or changing branches.
- Corrected runtime selector tests to assert that retired hosted runtimes stay hidden. Isolated the legacy usage-format compatibility unit test from production cloud policy by mocking its URL resolver and all fetch calls; no production cloud permissions were changed.
- Updated the subscription-flow harness expectations to provider-owned subscriptions without obsolete application quota/credit gates. Its Node process uses the logger's supported Node adapter rather than trying to start Electron through a CJS logger import.

## Executed checks

- Expanded `qa:agent2`: see final run count in PR verification comment; includes the two previously failing isolated suites as well as prompt improvement, provider routing, discovery, local speech, web reader and other targeted regressions.
- Four focused typechecks: coding-quality, prompt-improver, local TTS and public web reader.
- Presubmit formatting/lint: passes with five pre-existing nonfatal lint warnings, zero errors.
- Browser: prompt button placement, review/cost disclosure, mobile dialog fit, read-only IPC rejection, preservation of original draft and no uncaught page errors; Home/Settings/Library/Templates smoke checks also pass.
- Licensed skills: integrity verified for 11 skills / 27 files.
- Audit server/UI: two passing tests.
- Production dependency audit: two moderate advisories, zero high/critical. Not a clean audit.
- Native subscription-flow harness: **8 passing tests** using real SQLite and system Git, a mocked Electron interface and mocked model responses. This is not a live provider or full desktop E2E test.

## Native harness setup in this sandbox

Installed dependencies initially lacked native artifacts because they were installed with lifecycle scripts disabled. Downloaded the official Node v24.22.1 source archive from GitHub, built `node-pty` and `better-sqlite3` using the installed `@electron/node-gyp` and local compiler, and installed the locked fake-LLM-server dependencies with lifecycle scripts disabled. Used `LOCAL_GIT_DIRECTORY=/usr` so Dugite uses the existing real system Git rather than its missing downloaded distribution.

The native source archive, compiler outputs and dependency trees remain outside version control. No Electron binary was fabricated and no cloud/provider admission guard was bypassed. The native harness ran with:

```
LOCAL_GIT_DIRECTORY=/usr npm exec --yes --package=node@24 -- npx vitest run src/ipc/handlers/chat_stream_free_subscription.test.ts
```

## Remaining limits and merge disclosure

The prior platform CI run reported legacy subscription/quota/runtime expectations and broader desktop E2E failures. The identified unit expectations are corrected in this change, but full Windows/macOS E2E and live provider billing/audio remain unverified locally. The CLA check requires a human signature; the agent has not accepted it. Only a normal GitHub merge may be attempted at the user's request; no admin override, signing, disabled check, auto-merge or branch-protection change is authorized or performed.

A promise that ignores cancellation may continue internally; the fix bounds the app's wait and prevents its late result from mutating newer work. It cannot guarantee cancellation of provider-side computation or refund incurred usage. No universal performance multiplier, exhaustive error coverage, complete commercial migration or production certification is claimed.
