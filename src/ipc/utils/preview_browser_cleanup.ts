/**
 * Registry for releasing the preview browser session of a stopped app.
 *
 * `preview_browser_driver` depends on the tests handlers, which depend on the
 * process manager. The process manager therefore cannot import the driver
 * directly without creating a cycle, so the driver registers its release
 * function here instead and the process manager calls it on app stop.
 *
 * Without this, every app the agent drove leaves a full Playwright Chromium
 * (roughly 150-300 MB of RSS) alive for the rest of the Dyad session.
 */

type PreviewBrowserReleaser = (appId: number) => void;

let releasePreviewBrowserSession: PreviewBrowserReleaser | undefined;

export function setPreviewBrowserReleaser(
  releaser: PreviewBrowserReleaser,
): void {
  releasePreviewBrowserSession = releaser;
}

/**
 * Release the preview browser session owned by `appId`, if any.
 * Safe to call when no session was ever opened.
 */
export function releasePreviewBrowserForApp(appId: number): void {
  releasePreviewBrowserSession?.(appId);
}
