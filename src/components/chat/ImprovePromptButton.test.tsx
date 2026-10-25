import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImprovePromptButton } from "./ImprovePromptButton";
const mocks = vi.hoisted(() => ({ improve: vi.fn(), cancel: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { prompt: { improve: mocks.improve, cancelImprovement: mocks.cancel } },
}));
beforeEach(() => {
  mocks.improve.mockReset().mockResolvedValue({
    prompt: "Build an accessible notes app. Verify keyboard navigation.",
  });
  mocks.cancel.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Improve prompt" }));
}
function generate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate improvement" }));
}

it("requires explicit generation consent and explicit apply; never auto-sends", async () => {
  const apply = vi.fn();
  render(
    <ImprovePromptButton value="Build notes" chatId={7} onApply={apply} />,
  );
  open();
  expect(mocks.improve).not.toHaveBeenCalled();
  expect(screen.getByText(/Provider usage may incur charges/)).toBeTruthy();
  generate();
  await screen.findByRole("textbox", { name: "Proposed prompt" });
  expect(mocks.improve).toHaveBeenCalledTimes(1);
  expect(mocks.improve).toHaveBeenCalledWith({
    requestId: expect.any(String),
    prompt: "Build notes",
    chatId: 7,
  });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Proposed prompt" }), {
    target: { value: "My reviewed proposal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith(
    "Build notes",
    "My reviewed proposal",
  );
});
it.each(["", "   ", "a".repeat(12001)])(
  "disables empty/oversized drafts",
  (value) => {
    render(<ImprovePromptButton value={value} onApply={vi.fn()} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Improve prompt",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  },
);
it("does not overwrite a draft edited while generating", async () => {
  const apply = vi.fn();
  const view = render(<ImprovePromptButton value="Original" onApply={apply} />);
  open();
  generate();
  await screen.findByRole("textbox", { name: "Proposed prompt" });
  view.rerender(<ImprovePromptButton value="Newer edit" onApply={apply} />);
  expect(screen.getByText(/Your draft changed/)).toBeTruthy();
  const button = screen.getByRole("button", {
    name: "Apply to draft",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(apply).not.toHaveBeenCalled();
});
it("keeps the original on errors and allows an explicit retry", async () => {
  mocks.improve.mockRejectedValueOnce(
    new Error("Configure your model credentials"),
  );
  const apply = vi.fn();
  render(<ImprovePromptButton value="Original" onApply={apply} />);
  open();
  generate();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Configure your model credentials",
  );
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("textbox", { name: "Proposed prompt" });
  expect(mocks.improve).toHaveBeenCalledTimes(2);
});
it("cancels on close and ignores late results", async () => {
  let resolve!: (value: { prompt: string }) => void;
  mocks.improve.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<ImprovePromptButton value="Original" onApply={vi.fn()} />);
  open();
  generate();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.cancel).toHaveBeenCalledWith({
    requestId: mocks.improve.mock.calls[0][0].requestId,
  });
  open();
  await act(async () => resolve({ prompt: "Stale result" }));
  expect(screen.queryByRole("textbox", { name: "Proposed prompt" })).toBeNull();
});
it("cancels on chat switch and on unmount", async () => {
  mocks.improve.mockReturnValue(new Promise(() => {}));
  const view = render(
    <ImprovePromptButton value="Original" chatId={1} onApply={vi.fn()} />,
  );
  open();
  generate();
  view.rerender(
    <ImprovePromptButton value="Original" chatId={2} onApply={vi.fn()} />,
  );
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
  open();
  generate();
  view.unmount();
  expect(mocks.cancel).toHaveBeenCalledTimes(2);
});
it("prevents duplicate requests and disables during streaming", async () => {
  mocks.improve.mockReturnValue(new Promise(() => {}));
  const view = render(
    <ImprovePromptButton value="Original" onApply={vi.fn()} />,
  );
  open();
  generate();
  generate();
  expect(mocks.improve).toHaveBeenCalledTimes(1);
  view.rerender(
    <ImprovePromptButton value="Original" onApply={vi.fn()} disabled />,
  );
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(
    (
      screen.getByRole("button", {
        name: "Improve prompt",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
