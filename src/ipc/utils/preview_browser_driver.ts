import log from "electron-log/main";
import { getRunningTestBaseUrl } from "@/ipc/handlers/tests_handlers";
import { setPreviewBrowserReleaser } from "./preview_browser_cleanup";
import { detectSystemBrowserChannel } from "./playwright_bootstrap";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  formatNetworkEntries,
  formatPageContent,
  formatScopedSections,
  type NetworkEntry,
} from "./preview_browser_content";
import {
  domRoleForTag,
  formatDomOutline,
  MAX_DOM_ELEMENTS,
  MAX_DOM_DEPTH,
  type DomNode,
} from "./preview_dom_snapshot";

const logger = log.scope("preview_browser_driver");

/**
 * A long-lived Chromium page per running app, pointed at that app's preview
 * proxy. Dyad already runs Playwright against the same proxy URL for
 * `run_tests`; this reuses that base URL so ad-hoc inspection and
 * interaction see exactly the app the user is looking at, and so it works
 * for any dev server (Vite, Next.js, ...) rather than a specific framework.
 */

type ConsoleEntry = { type: string; text: string };

interface PendingRequest {
  method: string;
  url: string;
}

interface Session {
  page: any;
  /** Browser context, so the agent can open/switch/close preview tabs. */
  context: any;
  consoleLog: ConsoleEntry[];
  /** Requests that failed or came back with an error status. */
  networkLog: NetworkEntry[];
  /** Requests that are still in flight, keyed by the Playwright request. */
  pending: Map<unknown, PendingRequest>;
  /** Pages visited in this session, oldest first. */
  visited: { url: string; title: string }[];
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
  // Web fonts change the layout, so waiting for them avoids reading a page
  // mid-swap.
  await page
    .evaluate(() => (document as any)?.fonts?.ready)
    .catch(() => undefined);
  await waitForStableDom(page);
  // React/TanStack commit after the network goes quiet; give the paint a beat.
  await page.waitForTimeout(400);
}

/**
 * Wait until the DOM stops changing.
 *
 * The network going quiet does not mean the page finished rendering: a
 * client-side router can paint several frames after the last response, and
 * an agent that reads in that window sees a half-built UI. Comet solves this
 * with a readiness stabilizer that polls the document until the node count
 * and the text length hold still; this is the same idea.
 */
async function waitForStableDom(page: any, attempts = 8): Promise<void> {
  let previous = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const signature = await page
      .evaluate(() => {
        const body = document.body;
        if (!body) return "";
        return `${document.querySelectorAll("*").length}:${
          (body.innerText ?? "").length
        }`;
      })
      .catch(() => "");
    if (signature && signature === previous) return;
    previous = signature;
    await page.waitForTimeout(250).catch(() => undefined);
  }
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

/**
 * Track the requests the preview makes so the agent can see what broke:
 * requests that failed outright, responses with an error status, and requests
 * that are still in flight (a hung API call is the usual cause of a preview
 * that never becomes ready).
 */
const networkAttached = new WeakSet<any>();

function attachNetwork(
  page: any,
  networkLog: NetworkEntry[],
  pending: Map<unknown, PendingRequest>,
) {
  if (networkAttached.has(page)) return;
  networkAttached.add(page);
  page.on("request", (request: any) => {
    pending.set(request, {
      method: request.method?.() ?? "GET",
      url: request.url?.() ?? "",
    });
  });
  const settle = (request: any) => pending.delete(request);
  page.on("requestfinished", settle);
  page.on("requestfailed", (request: any) => {
    settle(request);
    networkLog.push({
      kind: "failed",
      method: request.method?.() ?? "GET",
      url: request.url?.() ?? "",
      failure: request.failure?.()?.errorText ?? "request failed",
    });
    if (networkLog.length > 200) networkLog.splice(0, networkLog.length - 200);
  });
  page.on("response", (response: any) => {
    const status = response.status?.() ?? 0;
    if (status < 400) return;
    networkLog.push({
      kind: "error",
      method: response.request?.().method?.() ?? "GET",
      url: response.url?.() ?? "",
      status,
    });
    if (networkLog.length > 200) networkLog.splice(0, networkLog.length - 200);
  });
}

/**
 * Accept JavaScript dialogs automatically.
 *
 * An `alert()` in the preview blocks the page until something clicks it, and
 * a headless browser has nobody to click it - the whole preview wedges until
 * the session is torn down. Accepting keeps the preview alive.
 */
const dialogsAttached = new WeakSet<any>();

function attachDialogs(page: any) {
  if (dialogsAttached.has(page)) return;
  dialogsAttached.add(page);
  page.on("dialog", (dialog: any) => {
    dialog.accept().catch(() => undefined);
  });
}

async function launchSession(appId: number, baseUrl: string): Promise<Session> {
  try {
    const { page, context, close } = await launchPage();
    const consoleLog: ConsoleEntry[] = [];
    const networkLog: NetworkEntry[] = [];
    const pending = new Map<unknown, PendingRequest>();
    attachConsole(page, consoleLog);
    attachNetwork(page, networkLog, pending);
    attachDialogs(page);

    const session: Session = {
      page,
      context,
      consoleLog,
      networkLog,
      pending,
      visited: [],
      close,
    };
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

/**
 * Remember the pages this preview session visited.
 *
 * Comet lets its assistant search its own browsing history before acting;
 * the preview's own history is the same idea on a smaller scale - the agent
 * can see where it has been instead of guessing a URL.
 */
async function recordVisit(session: Session) {
  const url = session.page.url();
  if (!url) return;
  const last = session.visited[session.visited.length - 1];
  if (last?.url === url) return;
  const title = await session.page.title().catch(() => "");
  session.visited.push({ url, title });
  if (session.visited.length > 50) {
    session.visited.splice(0, session.visited.length - 50);
  }
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
  await removeClickMarker(session.page);
  await settle(session.page);
  await recordVisit(session);
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
 * Wait for a condition instead of guessing with a fixed pause.
 *
 * The agent used to click and then read the page right away, which is flaky
 * for anything asynchronous. Waiting on the real condition - an element, some
 * text, a URL, or the network going quiet - makes a chain of actions
 * reliable.
 */
export interface PreviewWaitOptions {
  selector?: string;
  text?: string;
  url?: string;
  state?: "visible" | "hidden" | "attached" | "detached";
  timeoutMs?: number;
}

export async function previewWait(appId: number, options: PreviewWaitOptions) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const timeout = Math.min(
    Math.max(options.timeoutMs ?? ACTION_TIMEOUT_MS, 1_000),
    60_000,
  );
  const state = options.state ?? "visible";
  const selector = options.selector;
  const text = options.text;
  const urlNeedle = options.url;
  try {
    if (selector) {
      await session.page.locator(selector).first().waitFor({ state, timeout });
      return `Selector "${selector}" is now ${state}. ${await describePage(
        session.page,
        session.page.url(),
      )}`;
    }
    if (text) {
      await session.page
        .getByText(text, { exact: false })
        .first()
        .waitFor({ state, timeout });
      return `Text "${text}" is now ${state}. ${await describePage(
        session.page,
        session.page.url(),
      )}`;
    }
    if (urlNeedle) {
      await session.page.waitForURL(
        (candidate: URL) => candidate.toString().includes(urlNeedle),
        { timeout },
      );
      return `The URL now matches "${urlNeedle}". ${await describePage(
        session.page,
        session.page.url(),
      )}`;
    }
    await session.page.waitForLoadState("networkidle", { timeout });
    return `The preview finished loading. ${await describePage(
      session.page,
      session.page.url(),
    )}`;
  } catch (error) {
    return `The wait did not complete within ${timeout}ms: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * The full readable content of the page: headings, text and links.
 *
 * `read` returns a short summary of the visible text; this returns the whole
 * thing, which is what the agent needs when it has to reason about a page
 * that a snapshot cannot describe.
 */
export async function previewContent(appId: number, selectors?: string[]) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await settle(session.page);

  if (selectors && selectors.length > 0) {
    const scoped: { selector: string; count: number; text: string }[] =
      await session.page.evaluate((wanted: string[]) => {
        return wanted.map((selector) => {
          const nodes = Array.from(document.querySelectorAll(selector));
          const text = nodes
            .map((node) =>
              ((node as HTMLElement).innerText ?? node.textContent ?? "")
                .replace(/\s+/g, " ")
                .trim(),
            )
            .filter(Boolean)
            .join("\n\n")
            .trim();
          return { selector, count: nodes.length, text };
        });
      }, selectors);
    return formatScopedSections(
      scoped
        .filter((section) => section.count > 0)
        .map((section) => ({ selector: section.selector, text: section.text })),
      scoped
        .filter((section) => section.count === 0)
        .map((section) => section.selector),
    );
  }

  const extracted = await session.page.evaluate(() => {
    const root = (document.querySelector("main, article, [role=main]") ??
      document.body) as HTMLElement;
    const clean = (value: string | null | undefined) =>
      (value ?? "").replace(/\s+/g, " ").trim();
    return {
      title: document.title ?? "",
      headings: Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((element) => clean(element.textContent))
        .filter(Boolean)
        .slice(0, 40),
      text: (root.innerText ?? "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      links: Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 60)
        .map((element) => ({
          text: clean(element.textContent).slice(0, 80),
          href: (element as HTMLAnchorElement).href,
        }))
        .filter((link) => link.text || link.href),
    };
  });
  return formatPageContent({
    url: session.page.url(),
    title: extracted.title,
    headings: extracted.headings,
    text: extracted.text,
    links: extracted.links,
  });
}

/** The requests the preview made that failed, errored or are still pending. */
export async function previewNetwork(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const pending: NetworkEntry[] = Array.from(session.pending.values()).map(
    (request) => ({
      kind: "pending",
      method: request.method,
      url: request.url,
    }),
  );
  return formatNetworkEntries([...session.networkLog, ...pending]);
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
const MAX_PREVIEW_SCREENSHOT_CHARS = 60_000;

/** JPEG quality ladder used when the PNG is over budget. */
const SCREENSHOT_JPEG_QUALITIES = [70, 50, 30, 15];

export interface PreviewScreenshotOptions {
  /** Element handle to capture instead of the whole viewport. */
  ref?: string;
  /** Capture the entire scrollable page. */
  fullPage?: boolean;
}

export async function previewScreenshot(
  appId: number,
  options: PreviewScreenshotOptions = {},
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;

  const { session } = resolved;
  const target = options.ref
    ? refLocator(session.page, options.ref)
    : session.page;
  const fullPage = options.fullPage === true && !options.ref;

  const png = (await target.screenshot({
    type: "png",
    fullPage,
    // CSS pixels, not device pixels: a retina capture of the 1280x800
    // viewport is 4.1M pixels, which is over the ~1.15M pixel budget a
    // vision model can read usefully, and costs twice the tokens.
    scale: "css",
  })) as unknown as Buffer;
  const pngDataUrl = `data:image/png;base64,${png.toString("base64")}`;
  if (pngDataUrl.length <= MAX_PREVIEW_SCREENSHOT_CHARS) {
    return pngDataUrl;
  }

  // A PNG screenshot of a detailed UI is mostly noise for a model. Re-take it
  // as JPEG at decreasing quality until it fits the budget.
  for (const quality of SCREENSHOT_JPEG_QUALITIES) {
    const jpeg = (await target.screenshot({
      type: "jpeg",
      quality,
      fullPage,
      scale: "css",
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
 * app did not re-render that node. Handles are allocated by a counter that
 * lives on the page, so a handle is never reused for a different element and
 * a handle handed out by an earlier snapshot stays valid.
 */
async function collectSnapshot(page: any): Promise<SnapshotElement[]> {
  return await page.evaluate(
    (options: SnapshotOptions) => {
      const scope = window as unknown as { __dyadRefCounter?: number };
      const allocateRef = (element: Element): string => {
        const existing = element.getAttribute(options.attribute);
        if (existing) return existing;
        scope.__dyadRefCounter = (scope.__dyadRefCounter ?? 0) + 1;
        const ref = `ref_${scope.__dyadRefCounter}`;
        element.setAttribute(options.attribute, ref);
        return ref;
      };

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
        const ref = allocateRef(element);
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
  const ref = await target
    .evaluate((element: any, attribute: string) => {
      const scope = window as unknown as { __dyadRefCounter?: number };
      const existing = element.getAttribute(attribute);
      if (existing) return existing;
      scope.__dyadRefCounter = (scope.__dyadRefCounter ?? 0) + 1;
      const ref = `ref_${scope.__dyadRefCounter}`;
      element.setAttribute(attribute, ref);
      return ref;
    }, REF_ATTRIBUTE)
    .catch(() => "");
  if (!ref) {
    return `Found ${count} match(es) for "${
      selector ?? text
    }", but the element could not be tagged with a handle.`;
  }
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

/** Go back to the previous page in the preview's history. */
export async function previewGoBack(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const response = await session.page
    .goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    .catch(() => null);
  await settle(session.page);
  if (!response) {
    return "There is no previous page to go back to.";
  }
  await recordVisit(session);
  return `Went back. ${await describePage(session.page, session.page.url())}`;
}

/** Reload the current preview page. */
export async function previewReload(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await session.page.reload({
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  await settle(session.page);
  return `Reloaded the preview. ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/** Scroll an element addressed by a `ref_N` handle into view. */
export async function previewScrollToRef(appId: number, ref: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = refLocator(session.page, ref);
  await locator.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
  await settle(session.page);
  return `Scrolled ${ref} into view. ${await describePage(
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
      attachNetwork(page, session.networkLog, session.pending);
      attachDialogs(page);
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
      // Closing the tab the agent is currently driving would leave it without
      // a page to work with, so the active tab is never closed.
      if (target === session.page) {
        return "Refusing to close the active preview tab. Switch to another tab first and close that one instead.";
      }
      const remaining = context.pages().filter((page: any) => page !== target);
      await target.close().catch(() => undefined);
      if (remaining.length > 0) {
        session.page = remaining[0];
      } else {
        const page = await context.newPage();
        attachConsole(page, session.consoleLog);
        attachNetwork(page, session.networkLog, session.pending);
        session.page = page;
      }
      return "Closed the preview tab.";
    }
  }
}

/* ------------------------------------------------------------------ *
 * DOM outline, batch actions and coordinate clicks
 *
 * Comet gives its browser agent three things Dyad's preview tool was
 * missing: an accessibility outline with screen coordinates, a batch
 * action call, and a way to click a point on the screen. All three
 * are pure Playwright features, so they cost no new dependency.
 * ------------------------------------------------------------------ */

/** Tags that carry an action a user could take. */
const DOM_INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "summary",
  "details",
]);

/** Tags worth listing even when they are not interactive. */
const DOM_TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
  "td",
  "th",
  "label",
  "legend",
  "code",
  "pre",
  "blockquote",
  "article",
  "header",
  "footer",
  "aside",
  "main",
  "nav",
  "form",
  "fieldset",
  "img",
  "svg",
  "video",
  "audio",
  "small",
  "strong",
  "em",
  "caption",
  "figcaption",
]);

interface RawDomRow {
  tag: string;
  roleAttr: string;
  typeAttr: string;
  href: string;
  name: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  disabled: boolean;
  checked: boolean;
  value: string;
  interactive: boolean;
  ref: string;
}

/**
 * Collect the page's nodes as a flat, depth-annotated list.
 *
 * The role mapping happens in the main process (see `domRoleForTag`) so the
 * browser-side script stays a plain data collector.
 */
async function collectDomOutline(
  page: any,
  filter: "interactive" | "all" | "viewport",
  limit: number,
): Promise<RawDomRow[]> {
  return await page.evaluate(
    (options: {
      attribute: string;
      interactiveTags: string[];
      textTags: string[];
      limit: number;
      filter: string;
    }) => {
      const interactiveTags = new Set(options.interactiveTags);
      const textTags = new Set(options.textTags);
      const scope = window as unknown as { __dyadRefCounter?: number };
      const allocateRef = (element: Element): string => {
        const existing = element.getAttribute(options.attribute);
        if (existing) return existing;
        scope.__dyadRefCounter = (scope.__dyadRefCounter ?? 0) + 1;
        const ref = `ref_${scope.__dyadRefCounter}`;
        element.setAttribute(options.attribute, ref);
        return ref;
      };

      const clean = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const nameOf = (element: Element): string => {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) return clean(ariaLabel).slice(0, 120);
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          if (clean(text)) return clean(text).slice(0, 120);
        }
        const alt = element.getAttribute("alt");
        if (alt) return clean(alt).slice(0, 120);
        const title = element.getAttribute("title");
        if (title) return clean(title).slice(0, 120);
        const placeholder = element.getAttribute("placeholder");
        if (placeholder) return clean(placeholder).slice(0, 120);
        const value = (element as HTMLInputElement).value;
        if (value) return String(value).slice(0, 120);
        return clean(element.textContent).slice(0, 120);
      };

      const depthOf = (element: Element): number => {
        let depth = 0;
        let current = element.parentElement;
        while (current && current !== document.body) {
          depth += 1;
          current = current.parentElement;
        }
        return Math.min(depth, 20);
      };

      const rows: RawDomRow[] = [];
      const walk = (element: Element) => {
        if (rows.length >= options.limit) return;
        const tag = element.tagName.toLowerCase();
        if (
          tag === "script" ||
          tag === "style" ||
          tag === "noscript" ||
          tag === "template" ||
          tag === "head"
        ) {
          return;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity ?? "1") !== 0;
        const hasBox = !!rect && rect.width > 0 && rect.height > 0;
        const hasRole = element.hasAttribute("role");
        const isInteractive =
          (interactiveTags.has(tag) &&
            !(tag === "a" && !element.getAttribute("href"))) ||
          hasRole ||
          element.hasAttribute("onclick") ||
          element.getAttribute("contenteditable") === "true";

        const wanted =
          options.filter === "all"
            ? isInteractive || textTags.has(tag)
            : isInteractive;
        const inViewport =
          options.filter !== "viewport" ||
          (!!rect &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth);

        if (wanted && visible && hasBox && inViewport) {
          const input = element as HTMLInputElement;
          rows.push({
            tag,
            roleAttr: element.getAttribute("role") ?? "",
            typeAttr: element.getAttribute("type") ?? "",
            href: element.getAttribute("href") ?? "",
            name: nameOf(element),
            depth: depthOf(element),
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            disabled:
              element.hasAttribute("disabled") ||
              element.getAttribute("aria-disabled") === "true",
            checked: typeof input.checked === "boolean" ? input.checked : false,
            value:
              tag === "input" || tag === "textarea" || tag === "select"
                ? String(input.value ?? "")
                : "",
            interactive: isInteractive,
            ref: isInteractive ? allocateRef(element) : "",
          });
        }
        for (const child of Array.from(element.children)) {
          walk(child);
        }
      };

      if (document.body) walk(document.body);
      return rows;
    },
    {
      attribute: REF_ATTRIBUTE,
      interactiveTags: Array.from(DOM_INTERACTIVE_TAGS),
      textTags: Array.from(DOM_TEXT_TAGS),
      limit,
      filter,
    },
  );
}

export interface PreviewDomOptions {
  /** Which nodes to include. Defaults to "interactive". */
  filter?: "interactive" | "all" | "viewport";
  /** How deep to descend. Defaults to MAX_DOM_DEPTH. */
  depth?: number;
}

/**
 * The tabs of this preview session.
 *
 * Comet returns the tab context with every browser result, so the model
 * always knows which tab it acted on and what else is open. The agent can
 * otherwise act on a stale page after the preview switched tabs.
 */
async function tabContext(session: Session): Promise<string> {
  const pages = session.context.pages();
  const activeIndex = pages.indexOf(session.page);
  const lines: string[] = [];
  for (const [index, page] of pages.entries()) {
    const title = await page.title().catch(() => "");
    lines.push(
      `${index}: ${page.url()} - ${title}${page === session.page ? " (active)" : ""}`,
    );
  }
  return `Tabs (${pages.length}, active=${activeIndex}):\n${lines.join("\n")}`;
}

/**
 * The accessibility outline of the preview.
 *
 * Each line carries the role, the accessible name, a stable `ref` handle the
 * agent can click, the citation id it can refer to, and the screen position
 * it can click by coordinate.
 */
export async function previewDom(
  appId: number,
  options: PreviewDomOptions = {},
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await settle(session.page);
  const filter = options.filter ?? "interactive";
  const depth = Math.min(Math.max(options.depth ?? MAX_DOM_DEPTH, 1), 30);
  const rows = await collectDomOutline(session.page, filter, MAX_DOM_ELEMENTS);
  const nodes: DomNode[] = rows.map((row) => ({
    ref: row.ref || undefined,
    role: domRoleForTag(row.tag, {
      role: row.roleAttr || undefined,
      type: row.typeAttr || undefined,
      href: row.href || undefined,
    }),
    name: row.name,
    x: Math.round(row.x),
    y: Math.round(row.y),
    width: Math.round(row.width),
    height: Math.round(row.height),
    disabled: row.disabled || undefined,
    checked: row.checked || undefined,
    value: row.value || undefined,
    depth: row.depth,
  }));
  const url = session.page.url();
  const title = await session.page.title().catch(() => "");
  return [
    `URL: ${url}`,
    `Title: ${title}`,
    `DOM outline (${filter}, ${nodes.length} nodes):`,
    formatDomOutline(nodes, { maxDepth: depth, maxElements: MAX_DOM_ELEMENTS }),
    await tabContext(session),
  ].join("\n");
}

/** A single action inside a batch. */
export interface PreviewBatchAction {
  action: string;
  selector?: string;
  ref?: string;
  text?: string;
  key?: string;
  value?: string;
  url?: string;
  path?: string;
  submit?: boolean;
  kind?: "text" | "select" | "checkbox" | "radio" | "file";
  checked?: boolean;
  file_path?: string;
  delta_x?: number;
  delta_y?: number;
  index?: number;
  expression?: string;
  tab_action?: "list" | "new" | "switch" | "close";
  state?: "visible" | "hidden" | "attached" | "detached";
  timeout_ms?: number;
  full_page?: boolean;
  x?: number;
  y?: number;
}

const BATCH_FAILURE_PREFIX = "FAILED - ";

async function runBatchAction(
  appId: number,
  action: PreviewBatchAction,
): Promise<string> {
  switch (action.action) {
    case "navigate":
      return previewNavigate(appId, action.path ?? "/");
    case "click":
      if (action.ref) return previewClickRef(appId, action.ref);
      if (action.selector) return previewClick(appId, action.selector);
      return `${BATCH_FAILURE_PREFIX}'click' needs a selector or a ref.`;
    case "click_at":
      if (action.x === undefined || action.y === undefined) {
        return `${BATCH_FAILURE_PREFIX}'click_at' needs x and y.`;
      }
      return previewClickAt(appId, action.x, action.y);
    case "type":
      if (action.text === undefined) {
        return `${BATCH_FAILURE_PREFIX}'type' needs text.`;
      }
      if (action.ref) {
        return previewTypeRef(
          appId,
          action.ref,
          action.text,
          action.submit ?? false,
        );
      }
      if (action.selector) {
        return previewType(
          appId,
          action.selector,
          action.text,
          action.submit ?? false,
        );
      }
      return `${BATCH_FAILURE_PREFIX}'type' needs a selector or a ref.`;
    case "read":
      return previewRead(appId);
    case "content":
      return previewContent(appId);
    case "console":
      return previewConsole(appId);
    case "network":
      return previewNetwork(appId);
    case "screenshot":
      return previewScreenshot(appId, {
        ref: action.ref,
        fullPage: action.full_page,
      });
    case "snapshot":
      return previewSnapshot(appId);
    case "dom":
      return previewDom(appId);
    case "find":
      if (!action.text && !action.selector) {
        return `${BATCH_FAILURE_PREFIX}'find' needs text or a selector.`;
      }
      return previewFind(
        appId,
        action.text ?? "",
        action.selector,
        action.index,
      );
    case "hover":
      if (!action.ref) {
        return `${BATCH_FAILURE_PREFIX}'hover' needs a ref.`;
      }
      return previewHover(appId, action.ref);
    case "scroll":
      return previewScroll(appId, action.delta_x ?? 0, action.delta_y ?? 600);
    case "scroll_to":
      if (!action.ref) {
        return `${BATCH_FAILURE_PREFIX}'scroll_to' needs a ref.`;
      }
      return previewScrollToRef(appId, action.ref);
    case "press_key":
      if (!action.key) {
        return `${BATCH_FAILURE_PREFIX}'press_key' needs a key.`;
      }
      return previewPressKey(appId, action.key);
    case "wait":
      return previewWait(appId, {
        selector: action.selector,
        text: action.text,
        url: action.url,
        state: action.state,
        timeoutMs: action.timeout_ms,
      });
    case "back":
      return previewGoBack(appId);
    case "reload":
      return previewReload(appId);
    case "form_input":
      if (!action.ref) {
        return `${BATCH_FAILURE_PREFIX}'form_input' needs a ref.`;
      }
      return previewFormInput(
        appId,
        action.ref,
        action.kind ?? "text",
        action.value,
        action.checked,
        action.file_path,
      );
    case "evaluate":
      if (!action.expression) {
        return `${BATCH_FAILURE_PREFIX}'evaluate' needs an expression.`;
      }
      return previewEval(appId, action.expression);
    case "tabs":
      return previewTabs(
        appId,
        action.tab_action ?? "list",
        action.index,
        action.url,
      );
    default:
      return `${BATCH_FAILURE_PREFIX}unknown action "${action.action}".`;
  }
}

/**
 * Run several preview actions in one call.
 *
 * Comet calls this a computer batch: the agent describes a short sequence of
 * steps and gets one result back, instead of paying a round trip per step.
 * The batch stops at the first failure, because a step that did not happen
 * makes every later step's result meaningless.
 */
export async function previewBatch(
  appId: number,
  actions: PreviewBatchAction[],
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const results: string[] = [];
  for (const [index, action] of actions.entries()) {
    const outcome = await runBatchAction(appId, action);
    results.push(`${index + 1}. ${action.action}: ${outcome}`);
    if (outcome.startsWith(BATCH_FAILURE_PREFIX)) break;
  }
  return results.join("\n");
}

/**
 * Click a point on the screen.
 *
 * Sometimes a handle is not enough - an element rendered on a canvas, or a
 * spot inside a custom control - so the agent can click by the coordinates
 * the DOM outline reports.
 */
export async function previewClickAt(appId: number, x: number, y: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  await showClickMarker(session.page, x, y);
  await session.page.mouse.click(x, y);
  await settle(session.page);
  return `Clicked at (${x}, ${y}). ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/**
 * Mark where the agent just clicked.
 *
 * A screenshot after a click shows the result but not the target; the marker
 * makes the two line up. It is removed on the next navigation.
 */
async function showClickMarker(page: any, x: number, y: number) {
  await page
    .evaluate(
      (point: { x: number; y: number }) => {
        document.getElementById("__dyad_click_marker")?.remove();
        const marker = document.createElement("div");
        marker.id = "__dyad_click_marker";
        marker.style.position = "fixed";
        marker.style.left = `${point.x - 9}px`;
        marker.style.top = `${point.y - 9}px`;
        marker.style.width = "18px";
        marker.style.height = "18px";
        marker.style.borderRadius = "50%";
        marker.style.border = "2px solid #ff3b30";
        marker.style.pointerEvents = "none";
        marker.style.zIndex = "2147483647";
        document.body?.appendChild(marker);
      },
      { x, y },
    )
    .catch(() => undefined);
}

async function removeClickMarker(page: any) {
  await page
    .evaluate(() => {
      document.getElementById("__dyad_click_marker")?.remove();
    })
    .catch(() => undefined);
}
