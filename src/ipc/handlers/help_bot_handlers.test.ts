import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, any>(),
  client: vi.fn(),
  stream: vi.fn(),
  send: vi.fn(),
  read: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ log: vi.fn(), error: vi.fn() }) },
}));
vi.mock("./base", () => ({
  createTypedHandler: (contract: any, handler: any) =>
    mocks.handlers.set(contract.channel, handler),
}));
vi.mock("../../main/settings", () => ({ readSettings: mocks.read }));
vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.client,
}));
vi.mock("@/ipc/utils/model_effort", () => ({
  resolveDefaultModelSelection: mocks.resolve,
}));
vi.mock("../utils/safe_sender", () => ({ safeSend: mocks.send }));
vi.mock("../utils/stream_text_utils", () => ({
  cancelOrphanedBaseStream: vi.fn(),
  fastTextOutput: vi.fn(),
}));
vi.mock("ai", () => ({ streamText: mocks.stream }));
import { registerHelpBotHandlers } from "./help_bot_handlers";
const selectedModel = {
  provider: "anthropic",
  name: "chosen",
  effortLevel: "high",
};
const start = (sessionId: string, message = "How do I test?") =>
  mocks.handlers.get("help:chat:start")({ sender: {} }, { sessionId, message });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.read.mockReturnValue({
    selectedModel,
    proModelUsage: "api-key",
    enableDyadPro: true,
  });
  mocks.resolve.mockResolvedValue(selectedModel);
  mocks.client.mockResolvedValue({
    modelClient: { model: "configured-client" },
  });
  mocks.stream.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "Local help" };
    })(),
  });
  registerHelpBotHandlers();
});
it("streams help using the configured model, without hosted search or a hardcoded help provider", async () => {
  await start("routing");
  await vi.waitFor(() =>
    expect(mocks.send).toHaveBeenCalledWith(
      expect.anything(),
      "help:chat:response:end",
      { sessionId: "routing" },
    ),
  );
  expect(mocks.client).toHaveBeenCalledWith(
    selectedModel,
    expect.objectContaining({ enableDyadPro: false }),
  );
  const options = mocks.stream.mock.calls[0][0];
  expect(options.model).toBe("configured-client");
  expect(options.tools).toBeUndefined();
  expect(options.abortSignal).toBeInstanceOf(AbortSignal);
});
it("cancels the underlying provider request, not only the UI iterator", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.stream.mockReturnValue({
    fullStream: (async function* () {
      await wait;
      yield { type: "text-delta", text: "late" };
    })(),
  });
  await start("cancel");
  const signal = mocks.stream.mock.calls[0][0].abortSignal;
  await mocks.handlers.get("help:chat:cancel")({}, "cancel");
  release();
  expect(signal.aborted).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.send).not.toHaveBeenCalledWith(
    expect.anything(),
    "help:chat:response:chunk",
    expect.objectContaining({ sessionId: "cancel" }),
  );
});
it("rejects obsolete credit routing before constructing an inference client", async () => {
  mocks.read.mockReturnValue({ proModelUsage: "pro" });
  await expect(start("old-source")).rejects.toThrow("Select API keys");
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();
});
it("does not let an old cancelled stream finalize over a new stream with the same session", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.stream.mockReturnValueOnce({
    fullStream: (async function* () {
      await wait;
      yield { type: "text-delta", text: "obsolete" };
    })(),
  });
  await start("race");
  await start("race", "new task");
  release();
  await vi.waitFor(() =>
    expect(mocks.send).toHaveBeenCalledWith(
      expect.anything(),
      "help:chat:response:end",
      { sessionId: "race" },
    ),
  );
  expect(
    mocks.send.mock.calls.filter(
      ([, channel]) => channel === "help:chat:response:end",
    ),
  ).toHaveLength(1);
});

it("a stale client initialization failure cannot remove the replacement stream's cancellation handle", async () => {
  let rejectFirst!: (error: Error) => void;
  mocks.client.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectFirst = reject;
    }),
  );
  const first = start("client-race");
  await vi.waitFor(() => expect(mocks.client).toHaveBeenCalledTimes(1));
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.stream.mockReturnValue({
    fullStream: (async function* () {
      await wait;
      yield { type: "text-delta", text: "late" };
    })(),
  });
  await start("client-race", "replacement");
  const signal = mocks.stream.mock.calls[0][0].abortSignal;
  rejectFirst(new Error("outdated initialization failed"));
  await expect(first).rejects.toThrow("outdated initialization");
  await mocks.handlers.get("help:chat:cancel")({}, "client-race");
  expect(signal.aborted).toBe(true);
  release();
});
