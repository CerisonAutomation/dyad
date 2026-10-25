import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Agent2SourceSelector } from "./Agent2SourceSelector";
const mocks = vi.hoisted(() => ({
  connected: true,
  claudeConnected: false,
  claudeEnabled: false,
  usage: undefined as string | undefined,
  hasProKey: true,
  update: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableDyadPro: true,
      enableClaudeCodeSubscription: mocks.claudeEnabled,
      proModelUsage: mocks.usage,
      providerSettings: {
        auto: { apiKey: { value: mocks.hasProKey ? "test-pro" : "" } },
      },
    },
    updateSettings: mocks.update,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { connected: mocks.claudeConnected, compatible: true },
  }),
}));
vi.mock("@/hooks/useSubscriptionAccount", () => ({
  useSubscriptionAccount: () => ({ data: { connected: mocks.connected } }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));
beforeEach(() => {
  mocks.connected = true;
  mocks.claudeConnected = false;
  mocks.claudeEnabled = false;
  mocks.usage = undefined;
  mocks.hasProKey = true;
  vi.clearAllMocks();
});
it("allows a connected provider account without application credits", async () => {
  mocks.connected = false;
  mocks.claudeConnected = true;
  mocks.claudeEnabled = true;
  const user = userEvent.setup();
  render(<Agent2SourceSelector />);
  await user.click(screen.getByRole("button", { name: "Agent2 model source" }));
  await user.click(screen.getByRole("button", { name: "Provider account" }));
  expect(mocks.update).toHaveBeenCalledWith({
    proModelUsage: "subscription",
    enableDyadPro: false,
    enableClaudeCodeSubscription: true,
  });
  expect(
    screen.queryByText(/Dyad Pro|credits|unlock|upgrade/i),
  ).not.toBeInTheDocument();
});
it("offers automatic model-based routing without writing settings on mount", async () => {
  mocks.usage = "pro";
  const user = userEvent.setup();
  render(<Agent2SourceSelector />);
  await user.click(screen.getByRole("button", { name: "Agent2 model source" }));
  expect(screen.getByRole("button", { name: "Your API keys" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(mocks.update).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Automatic" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("keeps provider accounts selectable when disconnected", async () => {
  mocks.connected = false;
  const user = userEvent.setup();
  render(<Agent2SourceSelector />);
  await user.click(screen.getByRole("button", { name: "Agent2 model source" }));
  expect(
    screen.getByRole("button", { name: "Provider account" }),
  ).not.toBeDisabled();
});
it.each([true, false])(
  "selects BYOK without changing the model; account connected=%s",
  async (connected) => {
    mocks.connected = connected;
    mocks.hasProKey = false;
    const user = userEvent.setup();
    render(<Agent2SourceSelector />);
    await user.click(
      screen.getByRole("button", { name: "Agent2 model source" }),
    );
    await user.click(screen.getByRole("button", { name: "Your API keys" }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      proModelUsage: "api-key",
      enableDyadPro: false,
    });
  },
);
it("preserves an explicit provider account selection when it disconnects", async () => {
  mocks.connected = false;
  mocks.usage = "subscription";
  const user = userEvent.setup();
  render(<Agent2SourceSelector />);
  await user.click(screen.getByRole("button", { name: "Agent2 model source" }));
  expect(
    screen.getByRole("button", { name: "Provider account" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("allows explicit automatic routing without changing the selected model", async () => {
  mocks.usage = "api-key";
  const user = userEvent.setup();
  render(<Agent2SourceSelector />);
  await user.click(screen.getByRole("button", { name: "Agent2 model source" }));
  await user.click(screen.getByRole("button", { name: "Automatic" }));
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
    proModelUsage: undefined,
    enableDyadPro: false,
  });
});
