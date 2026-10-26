import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ImageGenerationSettingsControl } from "./ImageGenerationSettings";
const state = vi.hoisted(() => ({
  settings: { providerSettings: {}, imageGeneration: undefined } as any,
  save: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: state.settings, updateSettings: state.save }),
}));
afterEach(cleanup);
beforeEach(() => {
  state.settings = { providerSettings: {} };
  state.save.mockReset().mockResolvedValue({});
});
function choose(backend: string) {
  fireEvent.change(screen.getByLabelText("Image backend"), {
    target: { value: backend },
  });
}
function input(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it("saves an explicit Cloudflare model/account with a provider-secret token and no default model", async () => {
  render(<ImageGenerationSettingsControl />);
  choose("cloudflare");
  expect(
    (screen.getByLabelText("Image model ID") as HTMLInputElement).value,
  ).toBe("");
  input("Image model ID", "@cf/black-forest-labs/flux-1-schnell");
  input("Cloudflare account ID", "a".repeat(32));
  input("Image API token", "fixture-token");
  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const saved = state.save.mock.calls[0][0];
  expect(saved.imageGeneration.model).toBe(
    "@cf/black-forest-labs/flux-1-schnell",
  );
  expect(saved.providerSettings["image-cloudflare"].apiKey.value).toBe(
    "fixture-token",
  );
  expect(saved.imageGeneration).not.toHaveProperty("apiKey");
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Image API token") as HTMLInputElement).value,
    ).toBe(""),
  );
});
it("prevents silent paid-remote use and does not send a request merely to validate a form", async () => {
  render(<ImageGenerationSettingsControl />);
  choose("openai-compatible");
  input("Image model ID", "user-chosen");
  input("Image API base URL", "https://image-provider.example/v1");
  input("Image API token", "fixture-token");
  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));
  expect(screen.getByRole("alert").textContent).toContain("authorize");
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
});
it("permits an explicitly configured local image server without a remote API key", async () => {
  render(<ImageGenerationSettingsControl />);
  choose("openai-compatible");
  input("Image model ID", "local-image");
  input("Image API base URL", "http://127.0.0.1:7860/v1");
  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0][0]).not.toHaveProperty("providerSettings");
});
it("does not reveal a saved token and requires fresh consent before moving it to another endpoint", () => {
  state.settings = {
    providerSettings: { images: { apiKey: { value: "saved-secret" } } },
    imageGeneration: {
      backend: "openai-compatible",
      providerId: "images",
      model: "chosen",
      baseUrl: "https://old.example/v1",
      allowPaidRemote: true,
    },
  };
  render(<ImageGenerationSettingsControl />);
  expect(
    (screen.getByLabelText("Image API token") as HTMLInputElement).value,
  ).toBe("");
  input("Image API base URL", "https://new.example/v1");
  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));
  expect(screen.getByRole("alert").textContent).toContain("Re-enter");
  expect(state.save).not.toHaveBeenCalled();
});

it("offers GPT only through subscription OAuth and switches chat to subscription mode without storing an API key", async () => {
  render(<ImageGenerationSettingsControl />);
  choose("chatgpt-subscription");
  input("Image model ID", "user-selected-image-model");
  expect(screen.queryByLabelText("Image API token")).toBeNull();
  expect(screen.queryByLabelText("Image API base URL")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Connect/reconnect ChatGPT (OAuth)" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0][0].proModelUsage).toBe("subscription");
  expect(state.save.mock.calls[0][0]).not.toHaveProperty("providerSettings");
});
