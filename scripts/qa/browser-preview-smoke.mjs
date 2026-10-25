import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Start `npm run dev:renderer` first. Optional executable override supports CI
// images that provision Chromium separately from Playwright's browser cache.
const baseURL = process.env.BROWSER_PREVIEW_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? ["--no-zygote"] : [],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByText("What do you want to build?", { exact: true }).waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: "Browser development preview" })
    .waitFor();
  for (const [label, path, text] of [
    [
      "Settings",
      "/settings",
      "Manage your preferences, providers, and integrations.",
    ],
    ["Library", "/library", "No items in your library yet."],
    ["Templates", "/templates", "Pick your default template"],
    ["Apps", "/", "What do you want to build?"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((url) => url.pathname === path);
    await page.getByText(text, { exact: true }).waitFor();
    console.log(`PASS ${label}: ${path}`);
  }
  const mutationError = await page.evaluate(async () => {
    const { ipc } = await import("/src/ipc/types/index.ts");
    try {
      await ipc.settings.setUserSettings({ enableAutoUpdate: true });
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(
    mutationError,
    /read-only.*requires the Electron desktop backend/,
  );
  assert.deepEqual(errors, [], "No uncaught browser errors");
  if (process.env.BROWSER_PREVIEW_SCREENSHOT) {
    await page.screenshot({ path: process.env.BROWSER_PREVIEW_SCREENSHOT });
  }
  console.log(
    "PASS visible renderer, navigation, read-only action rejection, no uncaught page errors",
  );
} finally {
  await browser.close();
}
