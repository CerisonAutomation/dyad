import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatErrorBox } from "./ChatErrorBox";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: mocks.open } },
}));
beforeEach(() => vi.clearAllMocks());
it.each([
  '{"type":"FREE_AGENT_QUOTA_EXCEEDED","resetTime":1787295600000}',
  "FREE_MODEL_QUOTA_EXCEEDED",
  "dyad_free_model_quota_exceeded",
  "Dyad Free limit",
  "doesn't have a free quota tier",
  "ExceededBudget: quota",
])("replaces legacy quota upsells with provider recovery: %s", (error) => {
  const switchMode = vi.fn();
  render(
    <ChatErrorBox
      error={error}
      isDyadProEnabled={false}
      onDismiss={vi.fn()}
      onSwitchToBuildMode={switchMode}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "No application subscription or credits are required",
  );
  expect(
    screen.queryByText(/Upgrade|Get more AI credits|membership portal/),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Switch to Build" })).toBeNull();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(switchMode).not.toHaveBeenCalled();
});
it.each([false, true])(
  "uses the same provider recovery regardless of legacy entitlement %s",
  (enabled) => {
    render(
      <ChatErrorBox
        error='{"type":"SUBSCRIPTION_BILLING_ERROR","code":"OUT_OF_CREDITS"}'
        isDyadProEnabled={enabled}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Select a configured API-key provider",
    );
    expect(screen.getByRole("alert").textContent).not.toContain("Dyad");
    expect(screen.queryByRole("link")).toBeNull();
  },
);
it.each([
  "Provider returned error: LiteLLM Virtual Key expected",
  'All models failed. Fallbacks=[{"error":"LiteLLM Virtual Key expected"}]',
])(
  "recognizes rejected legacy connections without a membership link: %s",
  (error) => {
    render(<ChatErrorBox error={error} isDyadProEnabled onDismiss={vi.fn()} />);
    expect(screen.getByText(/legacy connection is unavailable/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  },
);
it("keeps ordinary provider diagnostics and makes recovery actions explicit", () => {
  const dismiss = vi.fn(),
    newChat = vi.fn(),
    build = vi.fn();
  render(
    <ChatErrorBox
      error="Provider returned error: 429 retry after 60 seconds"
      isDyadProEnabled={false}
      onDismiss={dismiss}
      onStartNewChat={newChat}
      onSwitchToBuildMode={build}
    />,
  );
  expect(screen.getByText(/429 retry after 60 seconds/)).toBeTruthy();
  expect(newChat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start new chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch to Build" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
  expect(newChat).toHaveBeenCalledOnce();
  expect(build).toHaveBeenCalledOnce();
  expect(dismiss).toHaveBeenCalledOnce();
});
it("opens a provider diagnostic link only after a user click", () => {
  render(
    <ChatErrorBox
      error="Read [provider help](https://example.com/help)"
      isDyadProEnabled={false}
      onDismiss={vi.fn()}
    />,
  );
  expect(mocks.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "provider help" }));
  expect(mocks.open).toHaveBeenCalledWith("https://example.com/help");
});
