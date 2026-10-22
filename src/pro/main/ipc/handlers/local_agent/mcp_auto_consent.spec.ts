import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  getModelClient: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: mocks.streamText };
});
vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.getModelClient,
}));
vi.mock("./mcp_consent_context", () => ({
  getRecentTurnsForConsent: vi.fn().mockResolvedValue([]),
  formatRecentTurns: vi.fn().mockReturnValue(""),
}));

import {
  buildMcpAutoApprove,
  classifyMcpToolConsent,
} from "./mcp_auto_consent";

function withText(text: string) {
  mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
  mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
}

const baseInput = {
  serverName: "srv",
  toolName: "tool",
  toolDescription: "does a thing",
  inputSchema: { type: "object" },
  args: { a: 1 },
  recentTurns: [],
  settings: {} as any,
};

describe("classifyMcpToolConsent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns allow and the reason for a valid allow decision", async () => {
    withText('{"reason":"safe read","decision":"allow"}');
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("allow");
    expect(d.reason).toBe("safe read");
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      baseInput.settings.selectedModel,
      baseInput.settings,
    );
  });

  it("classifies with the user's own model instead of a compiled-in one", async () => {
    withText('{"reason":"safe read","decision":"allow"}');
    const settings = {
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      proModelUsage: "api-key",
      selectedModel: { provider: "anthropic", name: "chosen-model" },
    };
    await classifyMcpToolConsent({ ...baseInput, settings: settings as any });
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      { provider: "anthropic", name: "chosen-model" },
      settings,
    );
  });
  it("parses a decision wrapped in prose/code fences", async () => {
    withText('Here:\n```json\n{"reason":"x","decision":"ask"}\n```');
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("ask");
  });

  it("fails closed (ask) on unparseable output", async () => {
    withText("no json here at all");
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("ask");
  });

  it("fails closed (ask) when the model call throws", async () => {
    mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
    mocks.streamText.mockImplementation(() => {
      throw new Error("network");
    });
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("ask");
  });

  it("defaults the reason when the model omits it", async () => {
    withText('{"decision":"allow"}');
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("allow");
    expect(d.reason).toBeTruthy();
  });

  it("fails closed (ask) when the model never responds (timeout)", async () => {
    mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
    // Stream that never resolves, so only the timeout can settle the race.
    mocks.streamText.mockReturnValue({ text: new Promise<string>(() => {}) });
    vi.useFakeTimers();
    try {
      const pending = classifyMcpToolConsent(baseInput);
      await vi.advanceTimersByTimeAsync(8000);
      const d = await pending;
      expect(d.decision).toBe("ask");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a single eight-second deadline across model-client setup and the request", async () => {
    // Resolving the model client takes 3s; the request must still be cut off
    // at the same eight-second deadline, not eight seconds after setup.
    mocks.getModelClient.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ modelClient: { model: {} } }), 3000),
        ),
    );
    mocks.streamText.mockReturnValue({ text: new Promise<string>(() => {}) });
    vi.useFakeTimers();
    try {
      const pending = classifyMcpToolConsent(baseInput);
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(7000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      const d = await pending;
      expect(d.decision).toBe("ask");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed (ask) when the model client never resolves", async () => {
    mocks.getModelClient.mockImplementation(() => new Promise(() => {}));
    mocks.streamText.mockReturnValue({ text: new Promise<string>(() => {}) });
    vi.useFakeTimers();
    try {
      const pending = classifyMcpToolConsent(baseInput);
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(8000);
      const d = await pending;
      expect(d.decision).toBe("ask");
      expect(settled).toBe(true);
      expect(mocks.streamText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not classify at all when the turn is already cancelled", async () => {
    withText('{"reason":"safe read","decision":"allow"}');
    const controller = new AbortController();
    controller.abort();

    const d = await classifyMcpToolConsent({
      ...baseInput,
      signal: controller.signal,
    });

    expect(d.decision).toBe("ask");
    expect(mocks.getModelClient).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("does not start the request when the turn is cancelled during setup", async () => {
    const controller = new AbortController();
    mocks.getModelClient.mockImplementation(async () => {
      controller.abort();
      return { modelClient: { model: {} } };
    });
    mocks.streamText.mockReturnValue({
      text: Promise.resolve('{"reason":"safe read","decision":"allow"}'),
    });

    const d = await classifyMcpToolConsent({
      ...baseInput,
      signal: controller.signal,
    });

    expect(d.decision).toBe("ask");
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
});

describe("buildMcpAutoApprove", () => {
  const baseParams = {
    settings: { autoApproveSafeMcpTools: true } as any,
    isDyadPro: true,
    chatId: 1,
    serverName: "srv",
    toolName: "tool",
    toolDescription: "does a thing",
    inputSchema: { type: "object" },
    args: { a: 1 },
  };

  beforeEach(() => vi.clearAllMocks());

  it("does not build an auto-approve callback for Dyad Free turns", () => {
    const autoApprove = buildMcpAutoApprove({
      ...baseParams,
      freeModelMode: true,
    });

    expect(autoApprove).toBeUndefined();
  });

  it("builds an auto-approve callback for Pro non-free turns when enabled", () => {
    const autoApprove = buildMcpAutoApprove({
      ...baseParams,
      freeModelMode: false,
    });

    expect(autoApprove).toEqual(expect.any(Function));
  });

  it("does not classify when the turn signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const autoApprove = buildMcpAutoApprove({
      ...baseParams,
      freeModelMode: false,
      signal: controller.signal,
    });

    const result = await autoApprove?.();

    expect(result).toEqual({
      approved: false,
      reason: expect.stringContaining("cancelled"),
    });
    expect(mocks.getModelClient).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
});
