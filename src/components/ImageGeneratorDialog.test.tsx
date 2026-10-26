import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGeneratorDialog } from "./ImageGeneratorDialog";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  configured: true,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));
vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ apps: [{ id: 7, name: "App" }] }),
}));
vi.mock("@/hooks/useGenerateImage", () => ({
  useGenerateImage: () => ({ start: mocks.start }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    loading: false,
    settings: mocks.configured
      ? {
          imageGeneration: {
            backend: "openai-compatible",
            providerId: "local",
            model: "fixture-image-model",
            baseUrl: "http://127.0.0.1:7860/v1",
            allowPaidRemote: false,
          },
        }
      : {},
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./AppSearchSelect", () => ({ AppSearchSelect: () => null }));

describe("ImageGeneratorDialog", () => {
  beforeEach(() => {
    mocks.start.mockReset();
    mocks.configured = true;
  });

  it("keeps the dialog and prompt open when submit admission is rejected", async () => {
    mocks.start.mockResolvedValue(null);
    const onOpenChange = vi.fn();
    render(
      <ImageGeneratorDialog
        open
        defaultAppId={7}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "A lighthouse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(
      "A lighthouse",
    );
  });

  it("admits only one submission while the first receipt is pending", async () => {
    const admission = deferred<string | null>();
    mocks.start.mockReturnValue(admission.promise);
    render(
      <ImageGeneratorDialog open defaultAppId={7} onOpenChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "A lighthouse" },
    });
    const generate = screen.getByRole("button", { name: "Generate" });

    fireEvent.click(generate);
    fireEvent.click(generate);

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Starting..." })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => admission.resolve(null));
  });

  it("ignores a stale admission after the dialog closes and reopens", async () => {
    const admission = deferred<string | null>();
    mocks.start.mockReturnValue(admission.promise);
    const onOpenChange = vi.fn();
    const view = render(
      <ImageGeneratorDialog
        open
        defaultAppId={7}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "A lighthouse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    view.rerender(
      <ImageGeneratorDialog
        open={false}
        defaultAppId={7}
        onOpenChange={onOpenChange}
      />,
    );
    view.rerender(
      <ImageGeneratorDialog
        open
        defaultAppId={7}
        onOpenChange={onOpenChange}
      />,
    );
    await act(async () =>
      admission.resolve("image-generation-job:stale-admission"),
    );

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

it("offers image-specific setup without a commercial gate when images are not configured", () => {
  mocks.configured = false;
  render(<ImageGeneratorDialog open onOpenChange={vi.fn()} defaultAppId={7} />);
  expect(
    screen.getByRole("link", { name: "Open image generation settings" }),
  ).toBeTruthy();
  expect(screen.queryByText("Pro-only feature")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
