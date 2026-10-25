import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
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
  await page.goto(process.env.BROWSER_PREVIEW_URL || "http://127.0.0.1:5174", {
    waitUntil: "domcontentloaded",
  });
  const improve = page.getByRole("button", {
    name: "Improve prompt",
    exact: true,
  });
  await improve.waitFor();
  assert(await improve.isDisabled(), "Empty draft must not invoke a model");
  const input = page.locator('[contenteditable="true"]').first();
  const draft = "Build an accessible notes app with keyboard navigation";
  await input.fill(draft);
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="Improve prompt"]').disabled,
  );
  const voice = page.getByRole("button", {
    name: "Speech-to-text backend unavailable",
  });
  const left = await improve.boundingBox();
  const right = await voice.boundingBox();
  assert(
    left &&
      right &&
      right.x > left.x &&
      right.x - left.x < 65 &&
      Math.abs(right.y - left.y) < 12,
    "Improve must sit beside the microphone",
  );
  await improve.click();
  await page.getByRole("dialog").waitFor();
  assert(await page.getByText(/Provider usage may incur charges/).isVisible());
  assert.equal(
    await page.getByRole("textbox", { name: "Original draft" }).inputValue(),
    draft,
  );
  await page.getByRole("button", { name: "Generate improvement" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: /read-only.*Electron/ })
    .waitFor();
  assert(
    await page.getByRole("button", { name: "Apply to draft" }).isDisabled(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await page.getByRole("dialog").boundingBox();
  assert(
    dialog && dialog.x >= 0 && dialog.x + dialog.width <= 391,
    "Dialog must fit mobile width",
  );
  await page.getByRole("button", { name: "Keep original" }).click();
  assert.equal(
    await input.innerText(),
    draft,
    "Errors/cancel must preserve the original draft",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS prompt button beside microphone, consent/review dialog, mobile width, real read-only IPC error, original draft preserved, no page errors",
  );
} finally {
  await browser.close();
}
