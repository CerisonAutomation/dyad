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
  await page.goto(baseURL, {
    waitUntil: "domcontentloaded",
    timeout: Number(process.env.BROWSER_PREVIEW_TIMEOUT_MS || 60_000),
  });
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
    ["Plugins", "/plugins", "No plugins added yet."],
    ["Apps", "/", "What do you want to build?"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((url) => url.pathname === path);
    await page.getByText(text, { exact: true }).waitFor();
    if (path === "/settings") {
      const form = page.getByRole("form", {
        name: "Image generation settings",
      });
      await form
        .getByLabel("Image backend")
        .selectOption("chatgpt-subscription");
      await form
        .getByRole("button", { name: "Connect/reconnect ChatGPT (OAuth)" })
        .waitFor();
      assert.equal(
        await form.getByLabel("Image API token", { exact: true }).count(),
        0,
      );
      assert.equal(
        await form.getByLabel("Image API base URL", { exact: true }).count(),
        0,
      );
      console.log(
        "PASS ChatGPT OAuth option exposes sign-in, not API token/endpoint controls",
      );
      await form.getByLabel("Image backend").selectOption("cloudflare");
      await form
        .getByLabel("Image model ID")
        .fill("@cf/black-forest-labs/flux-2-klein-4b");
      await form
        .getByLabel("Cloudflare input format")
        .selectOption("multipart");
      await form.getByLabel("Image width", { exact: true }).fill("768");
      assert.equal(
        await form.getByLabel("Image height", { exact: true }).inputValue(),
        "1024",
      );
      assert.equal(
        await form.getByText("Pro-only feature", { exact: true }).count(),
        0,
      );
      console.log(
        "PASS image-provider settings render, selectable multipart model and dimensions (no provider request)",
      );
    }
    if (path === "/plugins") {
      await page
        .getByText("shadcn — UI Registries", { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Add Plugin", exact: true })
          .isDisabled(),
        true,
      );
      assert(
        (await page
          .getByRole("button", { name: "Desktop only", exact: true })
          .count()) > 0,
      );
      for (const button of await page
        .getByRole("button", { name: "Desktop only", exact: true })
        .all())
        assert(await button.isDisabled());
      const search = page.getByRole("textbox", { name: "Search catalog" });
      await search.fill("shadcn");
      await page
        .getByText("shadcn — UI Registries", { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page
          .getByText(/Error: Browser preview is read-only: mcp:/)
          .count(),
        0,
      );
      console.log(
        "PASS Plugins: catalog browse/search, empty connections, disabled desktop actions, no MCP error toasts",
      );
    }
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
