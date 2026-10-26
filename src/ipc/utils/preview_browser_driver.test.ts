import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  closeAllPreviewBrowserSessions,
  closePreviewBrowserSession,
  previewRead,
  previewNavigate,
  previewClick,
  previewScreenshot,
  previewConsole,
  resolvePreviewTarget,
} from "./preview_browser_driver";
const mocks = vi.hoisted(() => ({ base: vi.fn(), launch: vi.fn() }));
vi.mock("@/ipc/handlers/tests_handlers", () => ({
  getRunningTestBaseUrl: mocks.base,
}));
vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn() }) },
}));
function fixture() {
  const listeners = new Map<string, (...args: any[]) => void>();
  const locator = {
    count: vi.fn(async () => 1),
    waitFor: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn((name: string, callback: (...args: any[]) => void) =>
      listeners.set(name, callback),
    ),
    goto: vi.fn(async (_url: string, _options?: unknown) => {}),
    isClosed: vi.fn(() => false),
    waitForLoadState: vi.fn(async (_state: string, _options?: unknown) => {}),
    waitForTimeout: vi.fn(async () => {}),
    url: vi.fn(() => "http://localhost:3456/"),
    title: vi.fn(async () => "App"),
    evaluate: vi.fn(async () => "Rendered app"),
    locator: vi.fn(() => locator),
    screenshot: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff])),
  };
  const context = {
    newPage: vi.fn(async () => page),
    route: vi.fn(
      async (
        _pattern: string,
        _handler: (route: unknown) => Promise<void>,
      ) => {},
    ),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  return { page, context, browser, locator, listeners };
}
let current: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.base.mockReturnValue("http://localhost:3456/");
  current = fixture();
  mocks.launch.mockResolvedValue(current.browser);
});
afterEach(async () => {
  await closeAllPreviewBrowserSessions();
});
it.each([
  "https://evil.test/",
  "//evil.test/",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "data:text/html,test",
  "http://user:pass@localhost:3456",
  "blob:http://localhost:3456/id",
])("blocks unsafe navigation %s", (path) => {
  expect(() => resolvePreviewTarget("http://localhost:3456/", path)).toThrow(
    "Preview navigation",
  );
});
it("resolves relative routes without changing origin", () => {
  expect(
    resolvePreviewTarget("http://localhost:3456/", "/settings?q=yes#title"),
  ).toBe("http://localhost:3456/settings?q=yes#title");
});
it("navigates on first inspection and shares concurrent launches", async () => {
  await Promise.all([previewRead(1), previewRead(1)]);
  expect(mocks.launch).toHaveBeenCalledTimes(1);
  expect(current.page.goto).toHaveBeenCalledWith(
    "http://localhost:3456/",
    expect.any(Object),
  );
  expect(
    current.page.waitForLoadState.mock.calls.every(
      (call) => call[0] === "domcontentloaded",
    ),
  ).toBe(true);
});
it("cleans up failed initialization and permits a subsequent explicit retry", async () => {
  current.page.goto.mockRejectedValueOnce(new Error("server down"));
  await expect(previewRead(1)).rejects.toThrow("server down");
  expect(current.browser.close).toHaveBeenCalledTimes(1);
  await expect(previewRead(1)).resolves.toContain("Rendered app");
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});
it("does not resurrect a closed in-flight launch", async () => {
  let resolve!: (value: unknown) => void;
  mocks.launch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const read = previewRead(1);
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalled());
  const closed = closePreviewBrowserSession(1);
  resolve(current.browser);
  await closed;
  expect(await read).toContain("No running preview");
  expect(current.browser.close).toHaveBeenCalled();
});
it("discards stale sessions after a proxy port change or app stop", async () => {
  await previewRead(1);
  mocks.base.mockReturnValue("http://localhost:4567/");
  await previewRead(1);
  expect(current.browser.close).toHaveBeenCalledTimes(1);
  expect(mocks.launch).toHaveBeenCalledTimes(2);
  mocks.base.mockReturnValue(undefined);
  expect(await previewRead(1)).toContain("No running preview");
  expect(current.browser.close).toHaveBeenCalledTimes(2);
});
it("blocks cross-origin document requests and permits application assets", async () => {
  await previewRead(1);
  const routeHandler = current.context.route.mock.calls[0][1] as (
    route: unknown,
  ) => Promise<void>;
  const route = {
    request: () => ({
      isNavigationRequest: () => true,
      url: () => "https://evil.test/redirect",
    }),
    abort: vi.fn(async () => {}),
    continue: vi.fn(async () => {}),
  };
  await routeHandler(route);
  expect(route.abort).toHaveBeenCalledTimes(1);
  expect(route.continue).not.toHaveBeenCalled();
  await routeHandler({
    ...route,
    request: () => ({ isNavigationRequest: () => false }),
  });
  expect(route.continue).toHaveBeenCalledTimes(1);
});
it("does not click the first of several ambiguous matches", async () => {
  current.locator.count.mockResolvedValueOnce(2);
  await expect(previewClick(1, "button")).rejects.toThrow("exactly one");
  expect(current.locator.click).not.toHaveBeenCalled();
});
it("encodes screenshot bytes as base64, not corrupt UTF-8", async () => {
  expect(await previewScreenshot(1)).toBe("data:image/jpeg;base64,/9j/");
});
it("bounds page-error logs as well as console logs", async () => {
  await previewRead(1);
  for (let i = 0; i < 250; i++)
    current.listeners.get("pageerror")!(new Error(`error-${i}`));
  const output = await previewConsole(1);
  expect(output).not.toContain("error-0\n");
  expect(output).toContain("error-249");
  expect(output.length).toBeLessThanOrEqual(8000);
});
it("fails external explicit navigation without issuing a second goto", async () => {
  await previewRead(1);
  await expect(previewNavigate(1, "https://evil.test")).rejects.toThrow(
    "Preview navigation",
  );
  expect(current.page.goto).toHaveBeenCalledTimes(1);
});
it("does not overwrite a concurrent replacement while closing a stale session", async () => {
  await previewRead(1);
  mocks.base.mockReturnValue("http://localhost:4567/");
  let finishClose!: () => void;
  current.browser.close.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finishClose = done;
      }),
  );
  const replacing = previewRead(1);
  await vi.waitFor(() =>
    expect(current.browser.close).toHaveBeenCalledTimes(1),
  );
  await previewRead(1);
  finishClose();
  await replacing;
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});
it("counts closed-but-pending launches against the resource limit", async () => {
  let finishLaunch!: (value: unknown) => void;
  const pending = new Promise((done) => {
    finishLaunch = done;
  });
  mocks.launch.mockReturnValue(pending);
  const reads = [1, 2, 3, 4].map(previewRead);
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(4));
  const closed = closePreviewBrowserSession(1);
  await expect(previewRead(5)).rejects.toThrow("limit reached");
  finishLaunch(current.browser);
  await Promise.all([...reads, closed]);
  expect(mocks.launch).toHaveBeenCalledTimes(4);
});
it("times out stuck page evaluation and discards its session", async () => {
  vi.useFakeTimers();
  try {
    current.page.evaluate.mockReturnValueOnce(new Promise<string>(() => {}));
    const read = expect(previewRead(1)).rejects.toThrow("operation timed out");
    await vi.waitFor(() => expect(current.page.evaluate).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(30_000);
    await read;
    expect(current.browser.close).toHaveBeenCalledTimes(1);
    await previewRead(1);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("proactively releases browser ownership when the page closes", async () => {
  await previewRead(1);
  current.listeners.get("close")!();
  await vi.waitFor(() =>
    expect(current.browser.close).toHaveBeenCalledTimes(1),
  );
  await previewRead(1);
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});
