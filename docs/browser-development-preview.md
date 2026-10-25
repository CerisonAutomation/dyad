# Existing app in Vite

Use Node 24 and run `npm run dev:renderer`. The real renderer is served on port
5174, bound to `0.0.0.0`, with localhost and Arena `.e2b.app` preview hosts allowed.
This is not the separate audit dashboard.

Electron normally boots the window session before mounting the router. An ordinary
browser has no preload/IPC bridge, so that handshake never completes. The explicit
`browser-preview` Vite mode now mounts the existing router without that desktop
handshake and supplies a narrow allowlist of read-only fixtures. A persistent
banner explains the limitations. Real Electron bridges always take precedence;
production and ordinary development/test modes do not enable this adapter.

The preview displays empty apps, unconfigured providers and sample preferences.
It does not load local settings, secrets, environment variables or app files.
Creating apps, saving settings, filesystem operations and AI/backend actions
fail explicitly: run the Electron app for those operations. Desktop session
listeners and chat-tab ownership publishing are skipped. Preview telemetry is
opted out and the unused Monaco CDN prewarm is skipped.

## Regression checks

- `npx vitest run src/browser_preview/adapter.test.ts src/ipc/contracts/core.test.ts src/pages/home.test.tsx`
- With Vite running and Playwright Chromium installed:
  `node scripts/qa/browser-preview-smoke.mjs`

The browser smoke check verifies visible home content, Settings/Library/Templates
navigation, rejection of a settings write and no uncaught page errors. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` for an independently provisioned browser,
`BROWSER_PREVIEW_URL` for a different preview origin, or
`BROWSER_PREVIEW_SCREENSHOT` to save a screenshot. Template thumbnail downloads
are external assets; restricted CI networks may prevent those images loading.
These checks do not establish Electron desktop or live inference functionality.
