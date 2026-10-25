import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerPromptImprovementHandlers } from "./prompt_improvement_handlers";
import { promptContracts } from "../types/prompts";
const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  settings: vi.fn(),
  chat: vi.fn(),
  refine: vi.fn(),
}));
vi.mock("./base", () => ({
  createTypedHandler: (contract: { channel: string }, handler: unknown) =>
    mocks.handlers.set(contract.channel, handler),
}));
vi.mock("@/main/settings", () => ({ readSettings: mocks.settings }));
vi.mock("../services/chat_inference_settings", () => ({
  getChatInferenceSettings: mocks.chat,
}));
vi.mock("@/pro/main/ipc/handlers/local_agent/tools/improve_prompt", () => ({
  refinePrompt: mocks.refine,
}));
const params = {
  requestId: "11111111-1111-4111-8111-111111111111",
  prompt: "Build notes",
};
const settings = {
  selectedModel: { provider: "custom::my-provider", name: "my-model" },
};
function sender(id = 1) {
  return Object.assign(new EventEmitter(), { id });
}
function improve(
  owner: ReturnType<typeof sender>,
  input: { requestId: string; prompt: string; chatId?: number } = params,
) {
  return mocks.handlers.get("prompts:improve")({ sender: owner }, input);
}
function cancel(
  owner: ReturnType<typeof sender>,
  requestId = params.requestId,
) {
  return mocks.handlers.get("prompts:improve:cancel")(
    { sender: owner },
    { requestId },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.handlers.clear();
  mocks.settings.mockReturnValue(settings);
  mocks.chat.mockResolvedValue(settings);
  mocks.refine.mockResolvedValue({
    versions: [{ prompt: "Improved notes task" }],
  });
  registerPromptImprovementHandlers();
});
it("uses current selected settings for Home without a fixed model", async () => {
  const owner = sender();
  expect(await improve(owner)).toEqual({ prompt: "Improved notes task" });
  expect(mocks.refine).toHaveBeenCalledWith(
    { prompt: "Build notes", iterations: 1 },
    settings,
    expect.any(AbortSignal),
  );
  expect(mocks.chat).not.toHaveBeenCalled();
  expect(owner.listenerCount("destroyed")).toBe(0);
});
it("resolves a chat's selected source instead of reading Home settings", async () => {
  const selected = {
    selectedModel: { provider: "anthropic", name: "accepted" },
  };
  mocks.chat.mockResolvedValue(selected);
  await improve(sender(), { ...params, chatId: 4 });
  expect(mocks.chat).toHaveBeenCalledWith(4);
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(mocks.refine.mock.calls[0][1]).toBe(selected);
});
it("bounds input and rejects malformed request identifiers at the contract", () => {
  for (const input of [
    { ...params, prompt: " " },
    { ...params, prompt: "a".repeat(12001) },
    { ...params, chatId: -1 },
    { ...params, requestId: "not-a-uuid" },
  ]) {
    expect(promptContracts.improve.input.safeParse(input).success).toBe(false);
  }
});
it("isolates cancellation by renderer and request ID and blocks duplicates", async () => {
  let resolve!: (value: unknown) => void;
  mocks.refine.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const owner = sender();
  const pending = improve(owner);
  const signal = mocks.refine.mock.calls[0][2] as AbortSignal;
  await expect(improve(owner)).rejects.toThrow("already running");
  await cancel(sender(2));
  await cancel(owner, "22222222-2222-4222-8222-222222222222");
  expect(signal.aborted).toBe(false);
  await cancel(owner);
  expect(signal.aborted).toBe(true);
  const rejected = expect(pending).rejects.toThrow();
  resolve({ versions: [{ prompt: "Late result" }] });
  await rejected;
  expect(owner.listenerCount("destroyed")).toBe(0);
  await expect(improve(owner)).resolves.toEqual({
    prompt: "Improved notes task",
  });
});
it("aborts on window destruction without applying a late result", async () => {
  let resolve!: (value: unknown) => void;
  mocks.refine.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const owner = sender();
  const pending = improve(owner);
  owner.emit("destroyed");
  expect((mocks.refine.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  const rejected = expect(pending).rejects.toThrow();
  resolve({ versions: [{ prompt: "Late result" }] });
  await rejected;
});
it("cleans up errors and rejects empty output", async () => {
  const owner = sender();
  mocks.refine.mockRejectedValueOnce(new Error("Provider unavailable"));
  await expect(improve(owner)).rejects.toThrow("Provider unavailable");
  expect(owner.listenerCount("destroyed")).toBe(0);
  mocks.refine.mockResolvedValueOnce({ versions: [{ prompt: " " }] });
  await expect(improve(owner)).rejects.toThrow("invalid prompt proposal");
  await expect(improve(owner)).resolves.toEqual({
    prompt: "Improved notes task",
  });
});

afterEach(() => vi.useRealTimers());
it("recovers immediately from an uncooperative hung refiner after cancellation", async () => {
  mocks.refine.mockReturnValueOnce(new Promise(() => {}));
  const owner = sender();
  const pending = improve(owner);
  const rejected = expect(pending).rejects.toThrow();
  await cancel(owner);
  await rejected;
  expect(owner.listenerCount("destroyed")).toBe(0);
  await expect(improve(owner)).resolves.toEqual({
    prompt: "Improved notes task",
  });
});
it("times out a hung settings lookup and releases the slot and timer", async () => {
  vi.useFakeTimers();
  mocks.chat.mockReturnValueOnce(new Promise(() => {}));
  const owner = sender();
  const pending = improve(owner, { ...params, chatId: 1 });
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(90_000);
  await rejected;
  expect(mocks.refine).not.toHaveBeenCalled();
  expect(owner.listenerCount("destroyed")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await expect(improve(owner)).resolves.toEqual({
    prompt: "Improved notes task",
  });
  expect(vi.getTimerCount()).toBe(0);
});
it("does not let a late cancelled settings lookup start inference or clear a newer slot", async () => {
  let resolve!: (value: unknown) => void;
  mocks.chat.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const owner = sender();
  const pending = improve(owner, { ...params, chatId: 1 });
  const rejected = expect(pending).rejects.toThrow();
  await cancel(owner);
  await rejected;
  mocks.refine.mockReturnValueOnce(new Promise(() => {}));
  const newer = improve(owner);
  const newerRejected = expect(newer).rejects.toThrow();
  resolve(settings);
  await Promise.resolve();
  expect(mocks.refine).toHaveBeenCalledTimes(1);
  await expect(improve(owner)).rejects.toThrow("already running");
  await cancel(owner);
  await newerRejected;
});
