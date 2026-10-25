import { beforeEach, expect, it, vi } from "vitest";
import { improvePromptTool, proposePromptRefinement } from "./improve_prompt";
import type { AgentContext } from "./types";
const mocks = vi.hoisted(() => ({ stream: vi.fn(), client: vi.fn() }));
vi.mock("@/ipc/utils/model_effort", () => ({
  resolveModelSelection: vi.fn(async ({ model, preferredEffortLevel }) => ({
    ...model,
    effortLevel: preferredEffortLevel ?? "medium",
  })),
}));
vi.mock("ai", () => ({ streamText: mocks.stream }));
vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.client,
}));
const ctx = {
  inferenceSettings: {
    selectedModel: {
      provider: "anthropic",
      name: "chosen",
      effortLevel: "high",
    },
    proModelUsage: "api-key",
    enableDyadPro: true,
  },
} as unknown as AgentContext;
beforeEach(() => {
  mocks.stream
    .mockReset()
    .mockReturnValue({ text: Promise.resolve("Refined task for review") });
  mocks.client.mockReset().mockResolvedValue({
    modelClient: { model: "selected-client", builtinProviderId: "anthropic" },
  });
});
it("uses the accepted model and API source without legacy routing", async () => {
  const result = await proposePromptRefinement({ prompt: "Build a form" }, ctx);
  expect(mocks.client).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "chosen",
      connection: "api-key",
      effortLevel: "high",
    }),
    expect.objectContaining({ enableDyadPro: false }),
  );
  expect(mocks.stream.mock.calls[0][0]).toMatchObject({
    model: "selected-client",
    maxRetries: 0,
    maxOutputTokens: 4096,
  });
  expect(mocks.stream.mock.calls[0][0].tools).toBeUndefined();
  expect(mocks.stream.mock.calls[0][0].providerOptions.anthropic.effort).toBe(
    "high",
  );
  expect(
    mocks.stream.mock.calls[0][0].providerOptions["dyad-engine"],
  ).toBeUndefined();
  expect(result).toMatchObject({
    applied: false,
    requiresUserApproval: true,
    templateVersion: "1.1.0",
  });
  expect(improvePromptTool.defaultConsent).toBe("ask");
});
it("bounds refinement to two proposals and rejects a third pass", async () => {
  expect(
    (await proposePromptRefinement({ prompt: "Build", iterations: 2 }, ctx))
      .versions,
  ).toHaveLength(2);
  expect(mocks.stream).toHaveBeenCalledTimes(2);
  await expect(
    proposePromptRefinement({ prompt: "Build", iterations: 3 }, ctx),
  ).rejects.toThrow();
  expect(mocks.stream).toHaveBeenCalledTimes(2);
});
it("propagates cancellation without generating a proposal", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    proposePromptRefinement(
      { prompt: "Build" },
      { ...ctx, abortSignal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
});
it("does not turn a paid legacy source into an implicit provider charge", async () => {
  await expect(
    proposePromptRefinement(
      { prompt: "Build" },
      {
        ...ctx,
        inferenceSettings: { ...ctx.inferenceSettings!, proModelUsage: "pro" },
      },
    ),
  ).rejects.toThrow("Select API keys");
  expect(mocks.client).not.toHaveBeenCalled();
});
it("rejects empty proposals and unavailable root settings", async () => {
  mocks.stream.mockReturnValue({ text: Promise.resolve(" ") });
  await expect(
    proposePromptRefinement({ prompt: "Build" }, ctx),
  ).rejects.toThrow("empty");
  await expect(
    proposePromptRefinement({ prompt: "Build" }, {} as unknown as AgentContext),
  ).rejects.toThrow("accepted root");
});

it("rejects truncated proposals instead of presenting incomplete text for application", async () => {
  mocks.stream.mockReturnValue({
    text: Promise.resolve("Incomplete proposal"),
    finishReason: Promise.resolve("length"),
  });
  await expect(
    proposePromptRefinement({ prompt: "Build" }, ctx),
  ).rejects.toThrow("output limit");
});
