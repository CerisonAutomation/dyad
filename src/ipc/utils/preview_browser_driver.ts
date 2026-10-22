import log from "electron-log/main";
import { getRunningTestBaseUrl } from "@/ipc/handlers/tests_handlers";
import { setPreviewBrowserReleaser } from "./preview_browser_cleanup";
import { detectSystemBrowserChannel } from "./playwright_bootstrap";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("preview_browser_driver");

/**
 * A long-lived Chromium page per running app, pointed at that app's preview
 * proxy. Dyad already runs Playwright against the same proxy URL for
 * `run_tests`; this reuses that base URL so ad-hoc inspection and
 * interaction see exactly the app the user is looking at, and so it works
 * for any dev server (Vite, Next.js, ...) rather than a specific framework.
 */

type ConsoleEntry = { type: string; text: string };

interface Session {
  page: any;
  /** Browser context, so the agent can open/switch/close preview tabs. */
  context: any;
  consoleLog: ConsoleEntry[];
  close: () => Promise<void>;
}

const sessions = new Map<number, Session>();
/** In-flight launches, so two concurrent tool calls for one app share a page. */
const launching = new Map<number, Promise<Session>>();
const NAV_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 10_000;

async function launchPage() {
  // Resolved lazily: the browser binary is only needed once an agent actually
  // drives the preview, and a failure here must not break app startup.
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    // The pinned Chromium build may be missing from the user's browser cache
    // (it is installed on demand from the app's Tests panel). A system
    // Chrome/Edge can drive the preview just as well.
    const channel = detectSystemBrowserChannel();
    if (channel) {
      try {
        browser = await chromium.launch({ headless: true, channel });
      } catch {
        // Fall through to the error below.
      }
    }
    if (!browser) {
      throw new DyadError(
        "Could not start the preview browser. Playwright's Chromium is not " +
          "installed on this machine — install it from the app's Tests panel, " +
          "or install Google Chrome. Underlying error: " +
          `${(error as Error).message}`,
        DyadErrorKind.External,
        { cause: error },
      );
    }
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  return {
    page,
    context,
    close: async () => {
      // Close the context as well as the browser: a browser with a live
      // context keeps its renderer processes and their caches alive.
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

/**
 * Client-rendered dev servers (Vite, Next.js) paint a splash or empty shell
 * before hydration finishes. Acting during that window sees zero elements and
 * reports a false "page is empty", so settle before observing or interacting.
 */
async function settle(page: any) {
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => undefined);
  // React/TanStack commit after the network goes quiet; give the paint a beat.
  await page.waitForTimeout(400);
}

async function getSession(appId: number): Promise<Session | null> {
  const existing = sessions.get(appId);
  if (existing) return existing;

  const inFlight = launching.get(appId);
  if (inFlight) return inFlight;

  const baseUrl = getRunningTestBaseUrl(appId);
  if (!baseUrl) {
    logger.debug("No running preview proxy for app", appId);
    return null;
  }

  const promise = launchSession(appId, baseUrl);
  launching.set(appId, promise);
  try {
    return await promise;
  } finally {
    launching.delete(appId);
  }
}

/**
 * Forward page console output and uncaught errors into the session buffer.
 * Shared by every tab so a newly opened tab reports the same way as the
 * first one.
 */
const consoleAttached = new WeakSet<any>();

function attachConsole(page: any, consoleLog: ConsoleEntry[]) {
  if (consoleAttached.has(page)) return;
  consoleAttached.add(page);
  page.on("console", (msg: any) => {
    consoleLog.push({ type: msg.type(), text: msg.text() });
    // Keep the buffer bounded; long agent sessions otherwise grow it without
    // limit and the console read becomes unusable.
    if (consoleLog.length > 200) consoleLog.splice(0, consoleLog.length - 200);
  });
  page.on("pageerror", (err: Error) => {
    consoleLog.push({ type: "pageerror", text: err.message });
  });
}

async function launchSession(appId: number, baseUrl: string): Promise<Session> {
  try {
    const { page, context, close } = await launchPage();
    const consoleLog: ConsoleEntry[] = [];
    attachConsole(page, consoleLog);

    const session: Session = { page, context, consoleLog, close };
    sessions.set(appId, session);
    logger.info("Preview browser session opened for app", appId, baseUrl);
    return session;
  } catch (error) {
    // Surface the real reason (missing browser binary, launch failure, ...)
    // instead of degrading into "the app is not running".
    logger.error("Failed to open preview browser session", error);
    throw new DyadError(
      `Could not open the preview browser: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
      { cause: error },
    );
  }
}

export async function closePreviewBrowserSession(appId: number): Promise<void> {
  const session = sessions.get(appId);
  if (!session) return;
  sessions.delete(appId);
  await session.close().catch(() => undefined);
}

/**
 * Fire-and-forget variant for teardown paths that must not await a browser
 * shutdown (an app stop, a crash recovery). The session is removed from the
 * map synchronously so a later call cannot reuse a session that is closing.
 */
export function closePreviewBrowserSessionSync(appId: number): void {
  const session = sessions.get(appId);
  if (!session) return;
  sessions.delete(appId);
  void session.close().catch(() => undefined);
}

export async function closeAllPreviewBrowserSessions(): Promise<void> {
  await Promise.all(
    [...sessions.keys()].map((id) => closePreviewBrowserSession(id)),
  );
}

// The process manager cannot import this module (it would create a cycle), so
// it releases stopped apps' sessions through the registry.
setPreviewBrowserReleaser(closePreviewBrowserSessionSync);

const NO_PREVIEW_MESSAGE =
  "The app is not currently running, so there is no preview to drive. Start the app first (preview the app), then retry.";

async function currentPage(appId: number) {
  const session = await getSession(appId);
  if (!session) return null;
  // The preview proxy can stop between the session lookup and here; without
  // this check the non-null assertion below would build a broken URL.
  const baseUrl = getRunningTestBaseUrl(appId);
  if (!baseUrl) return null;
  return { session, baseUrl };
}

export async function previewNavigate(appId: number, path: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session, baseUrl } = resolved;
  const target = /^https?:\/\//.test(path)
    ? path
    : new URL(path, baseUrl).toString();
  await session.page.goto(target, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  session.consoleLog.length = 0;
  await settle(session.page);
  return describePage(session.page, target);
}

export async function previewClick(appId: number, selector: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = session.page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.click({ timeout: ACTION_TIMEOUT_MS });
  await settle(session.page);
  return `Clicked ${selector}. ${await describePage(session.page, session.page.url())}`;
}

export async function previewType(
  appId: number,
  selector: string,
  text: string,
  submit: boolean,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = session.page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
  if (submit) {
    await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
    await settle(session.page);
  }
  return `Typed into ${selector}${submit ? " and pressed Enter" : ""}. ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/** Read the rendered page: title, url, and the text a user would actually see. */
export async function previewRead(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  await settle(resolved.session.page);
  return describePage(resolved.session.page, resolved.session.page.url());
}

export async function previewConsole(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { consoleLog } = resolved.session;
  if (consoleLog.length === 0)
    return "The preview has logged no console output.";
  return consoleLog
    .map((entry) => `[${entry.type}] ${entry.text}`)
    .join("\n")
    .slice(0, 8000);
}

/**
 * Screenshots are returned as a data URL and saved through the same path the
 * test-runner uses, so the agent can attach them without a new transport.
 */

/**
 * Budget for the returned data URL.
 *
 * The screenshot travels as a TEXT tool result, so its size is paid for
 * twice: it is retained in the SDK step state, the response messages, the
 * model-visible history and the persisted transcript, and it is re-sent to
 * the model on the next step. A retina PNG of a 1280x800 viewport is 2-5 MB
 * of binary, i.e. ~5.3 MB of base64 and ~1.3M tokens of context - which
 * exhausted the context window after a couple of screenshots and pushed the
 * stored transcript past the 10 MB limit that drops the structured history.
 */
const MAX_PREVIEW_SCREENSHOT_CHARS = 200_000;

/** JPEG quality ladder used when the PNG is over budget. */
const SCREENSHOT_JPEG_QUALITIES = [70, 50, 30, 15];

export async function previewScreenshot(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;

  const png = (await resolved.session.page.screenshot({
    type: "png",
    fullPage: false,
  })) as unknown as Buffer;
  const pngDataUrl = `data:image/png;base64,${png.toString("base64")}`;
  if (pngDataUrl.length <= MAX_PREVIEW_SCREENSHOT_CHARS) {
    return pngDataUrl;
  }

  // A PNG screenshot of a detailed UI is mostly noise for a model. Re-take it
  // as JPEG at decreasing quality until it fits the budget.
  for (const quality of SCREENSHOT_JPEG_QUALITIES) {
    const jpeg = (await resolved.session.page.screenshot({
      type: "jpeg",
      quality,
      fullPage: false,
    })) as unknown as Buffer;
    const jpegDataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    if (jpegDataUrl.length <= MAX_PREVIEW_SCREENSHOT_CHARS) {
      return jpegDataUrl;
    }
  }

  return (
    `The screenshot is too large to return (${Math.round(
      pngDataUrl.length / 1024,
    )} KB of base64, budget is ${Math.round(
      MAX_PREVIEW_SCREENSHOT_CHARS / 1024,
    )} KB). Use the 'read' action for the visible text or 'console' for the ` +
    "console output instead."
  );
}

async function describePage(page: any, url: string) {
  const title = await page.title().catch(() => "");
  const text = (await page.evaluate(() => document.body?.innerText ?? ""))
    .toString()
    .replace(/\s+/g, " ")
    .trim();
  return [
    `URL: ${url}`,
    `Title: ${title}`,
    `Visible text: ${text.slice(0, 4000)}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * DOM / AI control surface (Comet-browser style)
 *
 * The Comet browser MCP server exposes an accessibility snapshot with
 * stable `ref_N` handles, find-by-text, form filling, JS evaluation and
 * tab management. The native preview tool now offers the same surface, so
 * the agent can drive the preview without an external MCP server.
 * ------------------------------------------------------------------ */

/** Attribute used to hand an element a stable handle between calls. */
const REF_ATTRIBUTE = "data-dyad-ref";

/** Elements worth putting in a snapshot: anything a user can act on. */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  "[contenteditable=true]",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=switch]",
  "[role=combobox]",
  "[role=textbox]",
].join(",");

/** Cap on snapshot size so a huge page cannot flood the context. */
const MAX_SNAPSHOT_ELEMENTS = 200;

/** Refs are handed out per session; this counter keeps them unique. */
let refCounter = 0;

function nextRef(): string {
  refCounter += 1;
  return `ref_${refCounter}`;
}

interface SnapshotOptions {
  selector: string;
  attribute: string;
  limit: number;
}

interface SnapshotElement {
  ref: string;
  tag: string;
  role: string;
  name: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  depth: number;
}

/**
 * Tag every interactive element with a `ref_N` handle and describe it.
 *
 * Refs live on the DOM node (`data-dyad-ref`), so a later call can address
 * the element again without re-running the whole snapshot - as long as the
 * app did not re-render that node.
 */
async function collectSnapshot(page: any): Promise<SnapshotElement[]> {
  return await page.evaluate(
    (options: SnapshotOptions) => {
      for (const stale of Array.from(
        document.querySelectorAll(`[${options.attribute}]`),
      )) {
        stale.removeAttribute(options.attribute);
      }

      const describe = (element: Element): string => {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) return ariaLabel;
        const title = element.getAttribute("title");
        if (title) return title;
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text) return text.slice(0, 120);
        const value = (element as HTMLInputElement).value;
        if (value) return String(value).slice(0, 120);
        const placeholder = element.getAttribute("placeholder");
        if (placeholder) return placeholder.slice(0, 120);
        const name = element.getAttribute("name");
        return name ? name.slice(0, 120) : "";
      };

      const depthOf = (element: Element): number => {
        let depth = 0;
        let current = element.parentElement;
        while (current && current !== document.body) {
          depth += 1;
          current = current.parentElement;
        }
        return Math.min(depth, 6);
      };

      const elements: SnapshotElement[] = [];
      for (const element of Array.from(
        document.querySelectorAll(options.selector),
      )) {
        if (elements.length >= options.limit) break;
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const ref = `ref_${elements.length + 1}`;
        element.setAttribute(options.attribute, ref);
        const tag = element.tagName.toLowerCase();
        const input = element as HTMLInputElement;
        elements.push({
          ref,
          tag,
          role: element.getAttribute("role") ?? "",
          name: describe(element),
          value:
            tag === "input" || tag === "textarea" || tag === "select"
              ? String(input.value ?? "")
              : "",
          checked: typeof input.checked === "boolean" ? input.checked : false,
          disabled:
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true",
          depth: depthOf(element),
        });
      }
      return elements;
    },
    {
      selector: INTERACTIVE_SELECTOR,
      attribute: REF_ATTRIBUTE,
      limit: MAX_SNAPSHOT_ELEMENTS,
    },
  );
}

/** Locate an element by the handle a snapshot or find handed out. */
function refLocator(page: any, ref: string) {
  const safe = ref.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) {
    throw new DyadError(
      `Invalid element reference "${ref}".`,
      DyadErrorKind.Validation,
    );
  }
  return page.locator(`[${REF_ATTRIBUTE}="${safe}"]`).first();
}

/**
 * Accessibility-style snapshot of the preview: every interactive element
 * with a `ref_N` handle the agent can click, type into or hover.
 */
export async function previewSnapshot(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await settle(session.page);
  const elements = await collectSnapshot(session.page);
  const url = session.page.url();
  const title = await session.page.title().catch(() => "");
  if (elements.length === 0) {
    return [
      `URL: ${url}`,
      `Title: ${title}`,
      "The page exposes no interactive elements. Use the 'read' action for the visible text.",
    ].join("\n");
  }
  const lines = elements.map((element) => {
    const indent = "  ".repeat(element.depth);
    const role = element.role ? `[${element.role}]` : "";
    const state = [
      element.disabled ? "disabled" : "",
      element.checked ? "checked" : "",
      element.value ? `value=${JSON.stringify(element.value)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `${indent}- ${element.ref} <${element.tag}${role}> "${element.name}"${
      state ? ` (${state})` : ""
    }`;
  });
  return [
    `URL: ${url}`,
    `Title: ${title}`,
    `Elements (${elements.length}):`,
    ...lines,
  ].join("\n");
}

/**
 * Find an element by its visible text (or a CSS selector) and hand back a
 * `ref_N` handle for it.
 */
export async function previewFind(
  appId: number,
  text: string,
  selector?: string,
  index?: number,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const wanted = Math.max(0, index ?? 0);
  const locator = selector
    ? session.page.locator(selector)
    : session.page.getByText(text, { exact: false });
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return selector
      ? `No element matches the selector "${selector}". Take a 'snapshot' to see what the page exposes.`
      : `No element with the visible text "${text}" was found. Take a 'snapshot' to see what the page exposes.`;
  }
  if (wanted >= count) {
    return `Found ${count} match(es) but index ${wanted} was requested.`;
  }
  const target = locator.nth(wanted);
  const visible = await target.isVisible().catch(() => false);
  if (!visible) {
    return `Match ${wanted} of ${count} for "${
      selector ?? text
    }" is not visible.`;
  }
  const ref = nextRef();
  await target
    .evaluate(
      (element: any, value: { attribute: string; ref: string }) => {
        element.setAttribute(value.attribute, value.ref);
      },
      { attribute: REF_ATTRIBUTE, ref },
    )
    .catch(() => undefined);
  const description = await target
    .evaluate((element: any) => ({
      tag: element.tagName.toLowerCase(),
      text: (element.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120),
    }))
    .catch(() => ({ tag: "?", text: "" }));
  return `Found ${count} match(es) for "${
    selector ?? text
  }". Selected index ${wanted}: ${ref} <${description.tag}> "${description.text}"`;
}

/** Click an element addressed by a `ref_N` handle. */
export async function previewClickRef(appId: number, ref: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = refLocator(session.page, ref);
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.click({ timeout: ACTION_TIMEOUT_MS });
  await settle(session.page);
  return `Clicked ${ref}. ${await describePage(session.page, session.page.url())}`;
}

/** Type into an element addressed by a `ref_N` handle. */
export async function previewTypeRef(
  appId: number,
  ref: string,
  text: string,
  submit: boolean,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = refLocator(session.page, ref);
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
  if (submit) {
    await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
  }
  await settle(session.page);
  return `Typed into ${ref}${submit ? " and pressed Enter" : ""}. ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/** Hover an element addressed by a `ref_N` handle. */
export async function previewHover(appId: number, ref: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = refLocator(session.page, ref);
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.hover({ timeout: ACTION_TIMEOUT_MS });
  await settle(session.page);
  return `Hovered ${ref}. ${await describePage(session.page, session.page.url())}`;
}

/** Scroll the preview by a pixel delta. */
export async function previewScroll(
  appId: number,
  deltaX: number,
  deltaY: number,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await session.page.mouse.wheel(deltaX, deltaY);
  await settle(session.page);
  return `Scrolled by (${deltaX}, ${deltaY}). ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/** Press a key (for example "Enter", "Escape", "Tab") in the preview. */
export async function previewPressKey(appId: number, key: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await session.page.keyboard.press(key);
  await settle(session.page);
  return `Pressed ${key}. ${await describePage(session.page, session.page.url())}`;
}

/**
 * Fill a form control: text field, select, checkbox, radio or file input.
 */
export async function previewFormInput(
  appId: number,
  ref: string,
  kind: "text" | "select" | "checkbox" | "radio" | "file",
  value?: string,
  checked?: boolean,
  filePath?: string,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = refLocator(session.page, ref);
  await locator.waitFor({ state: "attached", timeout: ACTION_TIMEOUT_MS });
  switch (kind) {
    case "text":
      await locator.fill(value ?? "", { timeout: ACTION_TIMEOUT_MS });
      break;
    case "select":
      await locator.selectOption(value ?? "", { timeout: ACTION_TIMEOUT_MS });
      break;
    case "checkbox":
    case "radio": {
      if (checked === undefined) {
        throw new DyadError(
          `'form_input' with kind "${kind}" requires a 'checked' value.`,
          DyadErrorKind.Validation,
        );
      }
      if (checked) {
        await locator.check({ timeout: ACTION_TIMEOUT_MS });
      } else if (kind === "checkbox") {
        await locator.uncheck({ timeout: ACTION_TIMEOUT_MS });
      }
      break;
    }
    case "file": {
      if (!filePath) {
        throw new DyadError(
          "'form_input' with kind \"file\" requires a 'file_path'.",
          DyadErrorKind.Validation,
        );
      }
      await locator.setInputFiles(filePath, { timeout: ACTION_TIMEOUT_MS });
      break;
    }
  }
  await settle(session.page);
  return `Set ${kind} on ${ref}. ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/**
 * Evaluate a JavaScript expression in the preview page and return its
 * serialized result - the equivalent of typing into the browser console.
 */
export async function previewEval(appId: number, expression: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  try {
    const result = await session.page.evaluate((source: string) => {
      // Indirect eval keeps the expression in global scope, like a console.
      const value = (0, eval)(source);
      if (value === undefined) return { ok: true, text: "undefined" };
      try {
        return { ok: true, text: JSON.stringify(value) ?? String(value) };
      } catch {
        return { ok: true, text: String(value) };
      }
    }, expression);
    return `Expression result: ${result.text}`;
  } catch (error) {
    return `Expression failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/** Manage preview tabs: list, open, switch to, close. */
export async function previewTabs(
  appId: number,
  action: "list" | "new" | "switch" | "close",
  index?: number,
  url?: string,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const context = session.context;
  const pages = context.pages();
  switch (action) {
    case "list": {
      const lines: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        const title = await pages[i].title().catch(() => "");
        const marker = pages[i] === session.page ? " (active)" : "";
        lines.push(`${i}: ${pages[i].url()} - ${title}${marker}`);
      }
      return `Preview tabs (${pages.length}):\n${lines.join("\n")}`;
    }
    case "new": {
      const page = await context.newPage();
      attachConsole(page, session.consoleLog);
      session.page = page;
      if (url) {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
      }
      await settle(page);
      return `Opened a new preview tab${
        url ? ` at ${url}` : ""
      }. ${await describePage(page, page.url())}`;
    }
    case "switch": {
      const target = index === undefined ? undefined : pages[index];
      if (!target) {
        return `No preview tab at index ${index ?? 0}. Use tab_action 'list' to see the open tabs.`;
      }
      session.page = target;
      await settle(target);
      return `Switched to the preview tab at index ${index}. ${await describePage(
        target,
        target.url(),
      )}`;
    }
    case "close": {
      const target = index === undefined ? session.page : pages[index];
      if (!target) {
        return `No preview tab at index ${index ?? 0}.`;
      }
      const remaining = context.pages().filter((page: any) => page !== target);
      await target.close().catch(() => undefined);
      if (remaining.length > 0) {
        session.page = remaining[0];
      } else {
        const page = await context.newPage();
        attachConsole(page, session.consoleLog);
        session.page = page;
      }
      return "Closed the preview tab.";
    }
  }
}
