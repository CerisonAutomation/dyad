import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  previewClick: vi.fn(),
  previewClickRef: vi.fn(),
  previewConsole: vi.fn(),
  previewContent: vi.fn(),
  previewEval: vi.fn(),
  previewFind: vi.fn(),
  previewFormInput: vi.fn(),
  previewGoBack: vi.fn(),
  previewHover: vi.fn(),
  previewNavigate: vi.fn(),
  previewNetwork: vi.fn(),
  previewPressKey: vi.fn(),
  previewRead: vi.fn(),
  previewReload: vi.fn(),
  previewScroll: vi.fn(),
  previewScrollToRef: vi.fn(),
  previewScreenshot: vi.fn(),
  previewSnapshot: vi.fn(),
  previewTabs: vi.fn(),
  previewType: vi.fn(),
  previewTypeRef: vi.fn(),
  previewWait: vi.fn(),
  assertNotPrivateIp: vi.fn(),
  getRunningTestBaseUrl: vi.fn(),
}));

vi.mock("@/ipc/utils/preview_browser_driver", () => ({
  previewClick: mocks.previewClick,
  previewClickRef: mocks.previewClickRef,
  previewConsole: mocks.previewConsole,
  previewContent: mocks.previewContent,
  previewEval: mocks.previewEval,
  previewFind: mocks.previewFind,
  previewFormInput: mocks.previewFormInput,
  previewGoBack: mocks.previewGoBack,
  previewHover: mocks.previewHover,
  previewNavigate: mocks.previewNavigate,
  previewNetwork: mocks.previewNetwork,
  previewPressKey: mocks.previewPressKey,
  previewRead: mocks.previewRead,
  previewReload: mocks.previewReload,
  previewScroll: mocks.previewScroll,
  previewScrollToRef: mocks.previewScrollToRef,
  previewScreenshot: mocks.previewScreenshot,
  previewSnapshot: mocks.previewSnapshot,
  previewTabs: mocks.previewTabs,
  previewType: mocks.previewType,
  previewTypeRef: mocks.previewTypeRef,
  previewWait: mocks.previewWait,
}));

vi.mock("./network_utils", () => ({
  assertNotPrivateIp: mocks.assertNotPrivateIp,
}));

vi.mock("@/ipc/handlers/tests_handlers", () => ({
  getRunningTestBaseUrl: mocks.getRunningTestBaseUrl,
}));

const { previewBrowserTool } = await import("./preview_browser");

const ctx = { appId: 7 } as AgentContext;

describe("previewBrowserTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRunningTestBaseUrl.mockReturnValue("http://localhost:3210/");
  });

  it("is only enabled while an app is running", () => {
    expect(previewBrowserTool.isEnabled?.(ctx)).toBe(true);
    mocks.getRunningTestBaseUrl.mockReturnValue(undefined);
    expect(previewBrowserTool.isEnabled?.(ctx)).toBe(false);
  });

  it("returns the full page content", async () => {
    mocks.previewContent.mockResolvedValue("content");
    await expect(
      previewBrowserTool.execute({ action: "content" }, ctx),
    ).resolves.toBe("content");
    expect(mocks.previewContent).toHaveBeenCalledWith(7, undefined);
  });

  it("scopes the content action to the given selectors", async () => {
    mocks.previewContent.mockResolvedValue("scoped");
    await previewBrowserTool.execute(
      { action: "content", selectors: ["#main", ".row"] },
      ctx,
    );
    expect(mocks.previewContent).toHaveBeenCalledWith(7, ["#main", ".row"]);
  });

  it("returns the network failures", async () => {
    mocks.previewNetwork.mockResolvedValue("network");
    await expect(
      previewBrowserTool.execute({ action: "network" }, ctx),
    ).resolves.toBe("network");
    expect(mocks.previewNetwork).toHaveBeenCalledWith(7);
  });

  it("waits for a condition", async () => {
    mocks.previewWait.mockResolvedValue("waited");
    await expect(
      previewBrowserTool.execute(
        {
          action: "wait",
          selector: "#done",
          state: "visible",
          timeout_ms: 5000,
        },
        ctx,
      ),
    ).resolves.toBe("waited");
    expect(mocks.previewWait).toHaveBeenCalledWith(7, {
      selector: "#done",
      text: undefined,
      url: undefined,
      state: "visible",
      timeoutMs: 5000,
    });
  });

  it("rejects a wait without a condition", async () => {
    await expect(
      previewBrowserTool.execute({ action: "wait" }, ctx),
    ).rejects.toThrow(/requires a 'selector', 'text' or 'url'/);
    expect(mocks.previewWait).not.toHaveBeenCalled();
  });

  it("passes the element and full-page flags to a screenshot", async () => {
    mocks.previewScreenshot.mockResolvedValue("shot");
    await expect(
      previewBrowserTool.execute(
        { action: "screenshot", ref: "ref_2", full_page: true },
        ctx,
      ),
    ).resolves.toBe("shot");
    expect(mocks.previewScreenshot).toHaveBeenCalledWith(7, {
      ref: "ref_2",
      fullPage: true,
    });
  });

  it("keeps the private-address guard on absolute navigations", async () => {
    mocks.previewNavigate.mockResolvedValue("navigated");
    await previewBrowserTool.execute(
      { action: "navigate", path: "https://example.com/" },
      ctx,
    );
    expect(mocks.assertNotPrivateIp).toHaveBeenCalledWith(
      "https://example.com/",
    );
  });

  it("does not guard relative navigations", async () => {
    mocks.previewNavigate.mockResolvedValue("navigated");
    await previewBrowserTool.execute(
      { action: "navigate", path: "/settings" },
      ctx,
    );
    expect(mocks.assertNotPrivateIp).not.toHaveBeenCalled();
  });

  it("goes back and reloads the preview", async () => {
    mocks.previewGoBack.mockResolvedValue("back");
    mocks.previewReload.mockResolvedValue("reloaded");
    await expect(
      previewBrowserTool.execute({ action: "back" }, ctx),
    ).resolves.toBe("back");
    await expect(
      previewBrowserTool.execute({ action: "reload" }, ctx),
    ).resolves.toBe("reloaded");
    expect(mocks.previewGoBack).toHaveBeenCalledWith(7);
    expect(mocks.previewReload).toHaveBeenCalledWith(7);
  });

  it("scrolls a handle into view", async () => {
    mocks.previewScrollToRef.mockResolvedValue("scrolled");
    await expect(
      previewBrowserTool.execute({ action: "scroll_to", ref: "ref_4" }, ctx),
    ).resolves.toBe("scrolled");
    expect(mocks.previewScrollToRef).toHaveBeenCalledWith(7, "ref_4");
  });

  it("rejects a scroll_to without a handle", async () => {
    await expect(
      previewBrowserTool.execute({ action: "scroll_to" }, ctx),
    ).rejects.toThrow(/requires a 'ref' handle/);
  });

  it("describes the new actions in the consent preview", () => {
    expect(
      previewBrowserTool.getConsentPreview?.({ action: "content" }),
    ).toContain("full content");
    expect(
      previewBrowserTool.getConsentPreview?.({ action: "network" }),
    ).toContain("network");
    expect(
      previewBrowserTool.getConsentPreview?.({
        action: "wait",
        selector: "#done",
      }),
    ).toContain("#done");
  });
});
