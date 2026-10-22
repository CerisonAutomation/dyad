import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunningTestBaseUrl: vi.fn(),
  launch: vi.fn(),
  detectSystemBrowserChannel: vi.fn(),
}));

// The driver logs through electron-log and reads the running dev server's
// proxy URL; both are stubbed so the test never touches Electron or the DB.
vi.mock("electron-log/main", () => ({
  default: {
    scope: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
  },
}));

vi.mock("@/ipc/handlers/tests_handlers", () => ({
  getRunningTestBaseUrl: mocks.getRunningTestBaseUrl,
}));

vi.mock("./playwright_bootstrap", () => ({
  detectSystemBrowserChannel: mocks.detectSystemBrowserChannel,
}));

// No real browser is launched in the unit test: the fake page below stands in
// for Playwright's page.
vi.mock("playwright-core", () => ({
  chromium: { launch: mocks.launch },
}));

import {
  closeAllPreviewBrowserSessions,
  isTargetClosedError,
  PREVIEW_CLOSED_MESSAGE,
  previewBrowserSessionCount,
  previewClick,
} from "./preview_browser_driver";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * A stand-in for a Playwright page.
 *
 * `waitForTimeout` is the call that reports a dead preview ("page.waitForTimeout:
 * Target page, context or browser has been closed"), so the fake fails there
 * once the page is marked closed.
 */
function fakePage() {
  const state = { closed: false };
  const locator: any = {
    first: () => locator,
    nth: () => locator,
    waitFor: async () => {},
    click: async () => {},
    fill: async () => {},
    press: async () => {},
    hover: async () => {},
    count: async () => 1,
    isVisible: async () => true,
    evaluate: async () => "ref_1",
    scrollIntoViewIfNeeded: async () => {},
    selectOption: async () => {},
    check: async () => {},
    uncheck: async () => {},
    setInputFiles: async () => {},
  };
  const page = {
    state,
    on: () => {},
    url: () => "http://localhost:3210/",
    title: async () => "Preview",
    waitForLoadState: async () => {},
    evaluate: async () => "1:0",
    waitForTimeout: async () => {
      if (state.closed) {
        throw new Error(
          "page.waitForTimeout: Target page, context or browser has been closed",
        );
      }
    },
    goto: async () => {},
    reload: async () => {},
    goBack: async () => null,
    waitForURL: async () => {},
    screenshot: async () => Buffer.from("png"),
    locator: () => locator,
    getByText: () => locator,
    mouse: { wheel: async () => {}, click: async () => {} },
    keyboard: { press: async () => {} },
  };
  return page;
}

describe("isTargetClosedError", () => {
  it("recognises the Playwright closed-target failure", () => {
    expect(
      isTargetClosedError(
        new Error(
          "page.waitForTimeout: Target page, context or browser has been closed",
        ),
      ),
    ).toBe(true);
    expect(isTargetClosedError(new Error("Target closed"))).toBe(true);
    expect(
      isTargetClosedError(new Error("Browser has been closed unexpectedly")),
    ).toBe(true);
  });

  it("recognises the Playwright error name", () => {
    const named = new Error("something went wrong");
    named.name = "TargetClosedError";
    expect(isTargetClosedError(named)).toBe(true);
  });

  it("recognises a closed target wrapped as the cause of an error", () => {
    const wrapped = new DyadError("wrapped", DyadErrorKind.External, {
      cause: new Error("Target page, context or browser has been closed"),
    });
    expect(isTargetClosedError(wrapped)).toBe(true);
  });

  it("does not treat an unrelated failure as a closed target", () => {
    expect(isTargetClosedError(new Error("Timeout 10000ms exceeded"))).toBe(
      false,
    );
    expect(isTargetClosedError(undefined)).toBe(false);
    expect(isTargetClosedError(null)).toBe(false);
    expect(isTargetClosedError("boom")).toBe(false);
    expect(isTargetClosedError({})).toBe(false);
  });
});

describe("preview browser driver closed-target handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRunningTestBaseUrl.mockReturnValue("http://localhost:3210/");
    mocks.detectSystemBrowserChannel.mockReturnValue(undefined);
  });

  afterEach(async () => {
    await closeAllPreviewBrowserSessions();
  });

  it("reports a closed preview as a typed error, not the raw Playwright failure", async () => {
    const page = fakePage();
    const context = {
      newPage: async () => page,
      pages: () => [page],
      close: async () => {},
    };
    mocks.launch.mockResolvedValue({
      newContext: async () => context,
      close: async () => {},
    });
    page.state.closed = true;

    const error = await previewClick(7, "#submit").catch((thrown) => thrown);

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect((error as DyadError).message).toBe(PREVIEW_CLOSED_MESSAGE);
    expect((error as DyadError).message).not.toContain(
      "Target page, context or browser has been closed",
    );
  });

  it("drops the dead session so the next call starts a fresh browser", async () => {
    const page = fakePage();
    const context = {
      newPage: async () => page,
      pages: () => [page],
      close: async () => {},
    };
    mocks.launch.mockResolvedValue({
      newContext: async () => context,
      close: async () => {},
    });
    page.state.closed = true;

    await expect(previewClick(7, "#submit")).rejects.toThrow(
      PREVIEW_CLOSED_MESSAGE,
    );
    expect(previewBrowserSessionCount()).toBe(0);

    await expect(previewClick(7, "#submit")).rejects.toThrow(
      PREVIEW_CLOSED_MESSAGE,
    );
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(previewBrowserSessionCount()).toBe(0);
  });
});
