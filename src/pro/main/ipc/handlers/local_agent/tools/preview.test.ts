import { beforeEach, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import { inspectPreviewTool, controlPreviewTool } from "./preview";
const driver = vi.hoisted(() => ({
  previewRead: vi.fn(),
  previewDom: vi.fn(),
  previewConsole: vi.fn(),
  previewScreenshot: vi.fn(),
  previewNavigate: vi.fn(),
  previewClick: vi.fn(),
  previewType: vi.fn(),
  previewViewport: vi.fn(),
  closePreviewBrowserSession: vi.fn(),
}));
vi.mock("@/ipc/utils/preview_browser_driver", () => driver);
beforeEach(() => vi.resetAllMocks());
const context = (signal?: AbortSignal) =>
  ({
    appId: 7,
    abortSignal: signal,
    appendUserMessage: vi.fn(),
  }) as unknown as AgentContext;
it("exposes read-only inspection but requires consent for browser interaction", () => {
  expect(inspectPreviewTool.defaultConsent).toBe("always");
  expect(inspectPreviewTool.modifiesState).toBe(false);
  expect(controlPreviewTool.defaultConsent).toBe("ask");
  expect(controlPreviewTool.modifiesState).toBe(true);
  expect(controlPreviewTool.mutationTracking).toBe("none");
});
it("rejects arbitrary JS and unbounded input and viewport sizes", () => {
  for (const input of [
    { action: "evaluate", script: "document.cookie" },
    { action: "fill", selector: "#x", text: "x".repeat(12001) },
    { action: "viewport", width: 99999, height: 900 },
  ]) {
    expect(controlPreviewTool.inputSchema.safeParse(input).success).toBe(false);
  }
});
it("does not include filled text in the consent summary", () => {
  expect(
    controlPreviewTool.getConsentPreview?.({
      action: "fill",
      selector: "#name",
      text: "private-value",
      submit: false,
    }),
  ).not.toContain("private-value");
});
it("attaches actual image content instead of returning base64 as model text", async () => {
  const ctx = context();
  driver.previewScreenshot.mockResolvedValue("data:image/jpeg;base64,/9j/");
  expect(
    await inspectPreviewTool.execute({ action: "screenshot" }, ctx),
  ).toContain("Attached");
  expect(ctx.appendUserMessage).toHaveBeenCalledWith(
    expect.arrayContaining([
      { type: "image-url", url: "data:image/jpeg;base64,/9j/" },
    ]),
  );
});
it("defaults to DOM inspection", async () => {
  driver.previewDom.mockResolvedValue("DOM snapshot");
  expect(
    await inspectPreviewTool.execute(
      inspectPreviewTool.inputSchema.parse({}),
      context(),
    ),
  ).toBe("DOM snapshot");
  expect(driver.previewDom).toHaveBeenCalledWith(7);
});
it("does not start an operation after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    controlPreviewTool.execute(
      { action: "click", selector: "#save" },
      context(controller.signal),
    ),
  ).rejects.toThrow();
  expect(driver.previewClick).not.toHaveBeenCalled();
});
it("does not publish a late screenshot after cancellation", async () => {
  const controller = new AbortController();
  const ctx = context(controller.signal);
  driver.previewScreenshot.mockImplementation(async () => {
    controller.abort();
    return "data:image/jpeg;base64,/9j/";
  });
  await expect(
    inspectPreviewTool.execute({ action: "screenshot" }, ctx),
  ).rejects.toThrow();
  expect(ctx.appendUserMessage).not.toHaveBeenCalled();
});
it("dispatches bounded responsive viewport changes", async () => {
  const args = controlPreviewTool.inputSchema.parse({
    action: "viewport",
    width: 390,
    height: 844,
  });
  driver.previewViewport.mockResolvedValue("Mobile viewport");
  expect(await controlPreviewTool.execute(args, context())).toBe(
    "Mobile viewport",
  );
  expect(driver.previewViewport).toHaveBeenCalledWith(7, 390, 844);
});
it("fills only the requested selector and respects explicit submit", async () => {
  driver.previewType.mockResolvedValue("Filled");
  const args = controlPreviewTool.inputSchema.parse({
    action: "fill",
    selector: "#name",
    text: "new value",
  });
  expect(await controlPreviewTool.execute(args, context())).toBe("Filled");
  expect(driver.previewType).toHaveBeenCalledWith(
    7,
    "#name",
    "new value",
    false,
  );
});
it.each([
  { action: "navigate" },
  { action: "click" },
  { action: "fill", selector: "#x" },
  { action: "viewport", width: 390 },
])(
  "rejects missing action-specific arguments before touching the browser: %j",
  async (input) => {
    expect(controlPreviewTool.inputSchema.safeParse(input).success).toBe(false);
    await expect(
      controlPreviewTool.execute(input as never, context()),
    ).rejects.toThrow();
    for (const fn of Object.values(driver)) expect(fn).not.toHaveBeenCalled();
  },
);
