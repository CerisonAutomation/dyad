import log from "electron-log";
import type { Page } from "playwright";
import { collectPreviewDom } from "./preview_dom";
const logger = log.scope("preview_browser_driver");
const NAV_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 10_000;
const NO_PREVIEW =
  "No running preview. Start the app first, then inspect its rendered page.";
type Entry = { type: string; text: string };
type Session = { page: Page; close: () => Promise<void>; consoleLog: Entry[] };
type Slot = {
  baseUrl: string;
  closed: boolean;
  ready: Promise<Session | null>;
  session?: Session;
  tail: Promise<void>;
};
// One registry owns both pending launches and live pages. Closed slots cannot
// publish a late launch into a new generation for the same app.
const slots = new Map<number, Slot>();
let browserLeases = 0;
let browserModule: Promise<typeof import("playwright")> | undefined;

let previewHost:
  | Promise<typeof import("@/ipc/handlers/tests_handlers")>
  | undefined;
async function baseUrlFor(appId: number) {
  // Avoid importing the test/preview host (and its IPC graph) at tool registration.
  const { getRunningTestBaseUrl } = await (previewHost ??=
    import("@/ipc/handlers/tests_handlers").catch((error) => {
      previewHost = undefined;
      throw error;
    }));
  return getRunningTestBaseUrl(appId);
}
export function resolvePreviewTarget(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const target = new URL(path, base);
  if (
    !/^https?:$/.test(target.protocol) ||
    !/^https?:$/.test(base.protocol) ||
    base.username ||
    base.password ||
    target.origin !== base.origin ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "Preview navigation must stay on the running app's HTTP(S) origin. External pages and credential URLs are not allowed.",
    );
  }
  return target.href;
}
async function launch(slot: Slot): Promise<Session | null> {
  // Closing an in-flight launch must not free its resource slot prematurely.
  // Otherwise rapid close/reopen calls can bypass the four-browser bound.
  if (browserLeases >= 4)
    throw new Error(
      "Preview browser limit reached (4 apps), including launches still closing.",
    );
  browserLeases++;
  try {
    const session = await launchBrowser(slot);
    if (!session) {
      browserLeases--;
      return null;
    }
    const closeBrowser = session.close;
    let closed = false;
    session.close = async () => {
      if (closed) return;
      closed = true;
      try {
        await closeBrowser();
      } finally {
        browserLeases--;
      }
    };
    return session;
  } catch (error) {
    browserLeases--;
    throw error;
  }
}
async function launchBrowser(slot: Slot): Promise<Session | null> {
  const { chromium } = await (browserModule ??= import("playwright").catch(
    (error) => {
      browserModule = undefined;
      throw error;
    },
  ));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.DYAD_PREVIEW_CHROMIUM_EXECUTABLE || undefined,
    timeout: NAV_TIMEOUT_MS,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    const session: Session = {
      page,
      close: () => browser.close(),
      consoleLog: [],
    };
    const append = (type: string, text: string) => {
      session.consoleLog.push({ type, text: text.slice(0, 2000) });
      if (session.consoleLog.length > 200)
        session.consoleLog.splice(0, session.consoleLog.length - 200);
    };
    page.on("close", () => {
      // A crashed/closed page must not occupy one of the four browser leases
      // until the agent happens to inspect that same app again.
      for (const [appId, current] of slots) {
        if (current === slot) {
          void closePreviewBrowserSession(appId);
          break;
        }
      }
    });
    page.on("console", (msg) => append(msg.type(), msg.text()));
    page.on("pageerror", (error: Error) => append("pageerror", error.message));
    page.on("popup", (popup) => {
      void popup.close().catch(() => {});
    });
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => {});
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        try {
          resolvePreviewTarget(slot.baseUrl, request.url());
        } catch {
          append(
            "navigation-blocked",
            "Blocked navigation outside the running preview origin",
          );
          await route.abort();
          return;
        }
      }
      await route.continue();
    });
    await page.goto(resolvePreviewTarget(slot.baseUrl, slot.baseUrl), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    if (slot.closed) {
      await browser.close();
      return null;
    }
    slot.session = session;
    return session;
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}
async function getSlot(appId: number): Promise<Slot | null> {
  const baseUrl = await baseUrlFor(appId);
  let slot = slots.get(appId);
  if (
    slot &&
    (!baseUrl || slot.baseUrl !== baseUrl || slot.session?.page.isClosed())
  ) {
    await closePreviewBrowserSession(appId);
    // Another caller may already have published the replacement while close
    // awaited Playwright. Re-read the registry instead of overwriting it.
    return getSlot(appId);
  }
  if (!baseUrl) return null;
  if (!slot) {
    resolvePreviewTarget(baseUrl, baseUrl);
    if (slots.size >= 4)
      throw new Error(
        "Preview browser limit reached (4 apps). Close an unused preview session before opening another.",
      );
    slot = {
      baseUrl,
      closed: false,
      ready: Promise.resolve(null),
      tail: Promise.resolve(),
    };
    slots.set(appId, slot);
    const owned = slot;
    owned.ready = launch(owned).catch((error) => {
      if (slots.get(appId) === owned) slots.delete(appId);
      logger.warn("Preview launch failed; a later explicit call may retry");
      throw error;
    });
  }
  const session = await slot.ready;
  return session && !slot.closed ? slot : null;
}
export async function closePreviewBrowserSession(appId: number): Promise<void> {
  const slot = slots.get(appId);
  if (!slot) return;
  slot.closed = true;
  slots.delete(appId);
  const session = await slot.ready.catch(() => null);
  await session?.close().catch(() => {});
}
export async function closeAllPreviewBrowserSessions(): Promise<void> {
  await Promise.all([...slots.keys()].map(closePreviewBrowserSession));
}
async function withPage(
  appId: number,
  action: (session: Session, base: string) => Promise<string>,
): Promise<string> {
  const slot = await getSlot(appId);
  if (!slot) return NO_PREVIEW;
  // Parallel agent calls must not navigate/type into each other's intermediate page.
  const result = slot.tail.then(async () => {
    if (slot.closed || slot.session!.page.isClosed())
      throw new Error(
        "Preview closed. Inspect the current app again before retrying.",
      );
    // page.evaluate/title have no Playwright timeout. Bound the entire operation,
    // including a page whose main thread is wedged, and discard that session.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (slots.get(appId) === slot) void closePreviewBrowserSession(appId);
        reject(
          new Error(
            "Preview operation timed out after 30 seconds; the stuck session was closed. Inspect again to create a fresh session.",
          ),
        );
      }, 30_000);
      timer.unref?.();
    });
    return Promise.race([
      action(slot.session!, slot.baseUrl),
      deadline,
    ]).finally(() => clearTimeout(timer));
  });
  slot.tail = result.then(
    () => {},
    () => {},
  );
  return result;
}
async function settle(page: Page) {
  // Do not wait for networkidle: HMR, polling and analytics can keep it busy forever.
  await page.waitForLoadState("domcontentloaded", {
    timeout: ACTION_TIMEOUT_MS,
  });
  await page.waitForTimeout(150);
}
async function describePage(page: Page) {
  const text = await page.evaluate(() =>
    (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
  );
  return `URL: ${page.url()}\nTitle: ${await page.title()}\nVisible text: ${text}`;
}
async function uniqueLocator(page: Page, selector: string) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1)
    throw new Error(
      `Selector must identify exactly one element (matched ${count}). Inspect DOM and use a precise selector; do not repeat an unchanged failing selector.`,
    );
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  return locator;
}
export async function previewNavigate(appId: number, path: string) {
  return withPage(appId, async ({ page, consoleLog }, base) => {
    consoleLog.length = 0;
    await page.goto(resolvePreviewTarget(base, path), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await settle(page);
    return describePage(page);
  });
}
export async function previewClick(appId: number, selector: string) {
  return withPage(appId, async ({ page }) => {
    await (
      await uniqueLocator(page, selector)
    ).click({ timeout: ACTION_TIMEOUT_MS });
    await settle(page);
    return `Clicked ${selector}. ${await describePage(page)}`;
  });
}
export async function previewType(
  appId: number,
  selector: string,
  text: string,
  submit: boolean,
) {
  return withPage(appId, async ({ page }) => {
    const locator = await uniqueLocator(page, selector);
    await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
    if (submit) await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
    await settle(page);
    return `Filled ${selector}${submit ? " and submitted" : ""}. ${await describePage(page)}`;
  });
}
export async function previewRead(appId: number) {
  return withPage(appId, async ({ page }) => {
    await settle(page);
    return describePage(page);
  });
}
export async function previewDom(appId: number) {
  return withPage(appId, async ({ page }) => {
    await settle(page);
    return JSON.stringify(await page.evaluate(collectPreviewDom)).slice(
      0,
      14000,
    );
  });
}
export async function previewConsole(appId: number) {
  return withPage(
    appId,
    async ({ consoleLog }) =>
      consoleLog
        .map((e) => `[${e.type}] ${e.text}`)
        .join("\n")
        .slice(-8000) || "No console output.",
  );
}
export async function previewScreenshot(appId: number) {
  return withPage(appId, async ({ page }) => {
    const data = await page.screenshot({
      type: "jpeg",
      quality: 55,
      scale: "css",
      fullPage: false,
      animations: "disabled",
      timeout: ACTION_TIMEOUT_MS,
    });
    const result = `data:image/jpeg;base64,${Buffer.from(data).toString("base64")}`;
    return result.length <= 60_000
      ? result
      : "Screenshot exceeds the 60,000-character context budget. Inspect DOM or visible text instead.";
  });
}

export async function previewViewport(
  appId: number,
  width: number,
  height: number,
) {
  if (
    !Number.isInteger(width) ||
    width < 320 ||
    width > 1920 ||
    !Number.isInteger(height) ||
    height < 240 ||
    height > 1200
  )
    throw new Error("Viewport must be 320–1920 by 240–1200 pixels.");
  return withPage(appId, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await settle(page);
    return `Viewport ${width}x${height}. ${await describePage(page)}`;
  });
}
