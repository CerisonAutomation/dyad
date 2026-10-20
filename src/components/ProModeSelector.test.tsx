import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProModeSelector } from "./ProModeSelector";
const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  update: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.update,
  }),
}));
beforeEach(() => {
  mocks.settings = { enableAgent2: true };
  vi.clearAllMocks();
});

it("opens the Agent2 panel and shows Agent2 features", async () => {
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));

  expect(screen.getByText("Agent2 Mode")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Enable Agent2" })).toBeChecked();
  expect(
    screen.getByRole("button", { name: /Agent2 features/i }),
  ).toBeInTheDocument();
});

it("reflects a disabled Agent2 toggle from settings", async () => {
  mocks.settings = { enableAgent2: false };
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));

  expect(
    screen.getByRole("switch", { name: "Enable Agent2" }),
  ).not.toBeChecked();
});

it("persists the Agent2 toggle through settings", async () => {
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));
  await user.click(screen.getByRole("switch", { name: "Enable Agent2" }));

  expect(mocks.update).toHaveBeenCalledWith({ enableAgent2: false });
});

it("exposes Web Access, Turbo Edits and Smart Context inside Agent2 features", async () => {
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));
  await user.click(screen.getByRole("button", { name: /Agent2 features/i }));

  expect(
    screen.getByRole("switch", { name: "Web Access" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("turbo-edits-selector")).toBeInTheDocument();
  expect(screen.getByTestId("smart-context-selector")).toBeInTheDocument();
});

it("writes the Turbo Edits selection", async () => {
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));
  await user.click(screen.getByRole("button", { name: /Agent2 features/i }));
  await user.click(screen.getByRole("button", { name: "Search & replace" }));

  expect(mocks.update).toHaveBeenCalledWith({
    enableProLazyEditsMode: true,
    proLazyEditsMode: "v2",
  });
});

it("writes the Smart Context selection", async () => {
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));
  await user.click(screen.getByRole("button", { name: /Agent2 features/i }));
  await user.click(screen.getByRole("button", { name: "Balanced" }));

  expect(mocks.update).toHaveBeenCalledWith({
    enableProSmartFilesContextMode: true,
    proSmartContextOption: "balanced",
  });
});

it("turns an active feature off when its current option is selected", async () => {
  mocks.settings = {
    enableAgent2: true,
    enableProLazyEditsMode: true,
    proLazyEditsMode: "v2",
  };
  const user = userEvent.setup();
  render(<ProModeSelector />);

  await user.click(screen.getByRole("button", { name: "Agent2" }));
  await user.click(screen.getByRole("button", { name: /Agent2 features/i }));
  const turbo = within(screen.getByTestId("turbo-edits-selector"));
  await user.click(turbo.getByRole("button", { name: "Off" }));

  expect(mocks.update).toHaveBeenCalledWith({ enableProLazyEditsMode: false });
});
