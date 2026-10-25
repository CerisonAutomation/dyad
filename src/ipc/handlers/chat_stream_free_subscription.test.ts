// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { eq } from "drizzle-orm";
import { chats, messages } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

// This is a Node harness, not an Electron process. Use the logger's supported
// Node adapter so CJS imports do not try to boot the desktop binary.
vi.mock("electron-log/main", async () => await import("electron-log/node"));

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  process.env.E2E_TEST_BUILD = "true";
  return {
    ipcHandlers: new Map(),
    credits: vi.fn(),
    model: vi.fn(),
    account: vi.fn(),
  };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
vi.mock("@/ipc/services/codex_subscription_account", () => ({
  getSubscriptionAccount: h.account,
}));
vi.mock("@/ipc/services/codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: async () => ({
    access: "test-access",
    accountId: "test-account",
  }),
}));
vi.mock("@/ipc/services/codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: h.credits,
}));
vi.mock("@/ipc/utils/codex_subscription_provider", () => ({
  createCodexSubscriptionModel: h.model,
}));
let harness: ChatFlowHarness;
beforeAll(async () => {
  harness = await setupChatFlowHarness({
    electronMock: h,
    selectedModel: { provider: "openai", name: "gpt-5" },
    chatMode: "local-agent",
    settings: {
      enableDyadPro: false,
      proModelUsage: "subscription",
      providerSettings: {},
    },
  });
}, 60_000);
beforeEach(async () => {
  h.account
    .mockReset()
    .mockResolvedValue({ connected: true, models: ["gpt-5"] });
  writeSettings({
    enableDyadPro: false,
    selectedChatMode: "local-agent",
    defaultChatMode: "local-agent",
    providerSettings: {},
  });
  await harness.db
    .update(chats)
    .set({ chatMode: "local-agent" })
    .where(eq(chats.id, harness.chatId));
  h.credits
    .mockReset()
    .mockRejectedValue(new Error("Free users must not check Pro credits"));
  h.model.mockReset().mockImplementation(
    async () =>
      new MockLanguageModelV3({
        modelId: "gpt-5",
        provider: "openai",
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "answer" },
              {
                type: "text-delta",
                id: "answer",
                delta: "Subscription response.",
              },
              { type: "text-end", id: "answer" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        }),
      }),
  );
  await harness.db.delete(messages);
});
afterAll(async () => {
  await harness?.dispose();
});

it.each(["build", "ask", "plan", "local-agent"] as const)(
  "keeps provider-owned subscription inference independent of legacy Pro settings in stored %s mode",
  async (chatMode) => {
    writeSettings({
      enableDyadPro: true,
      selectedChatMode: chatMode === "local-agent" ? "build" : "local-agent",
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
    });
    await harness.db
      .update(chats)
      .set({ chatMode })
      .where(eq(chats.id, harness.chatId));
    const result = await harness.streamChat(
      "Say hello without changing files.",
    );
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(h.credits).not.toHaveBeenCalled();
    expect(h.account).toHaveBeenCalled();
    expect(h.model).toHaveBeenCalled();
    expect(h.model.mock.calls.every((call) => call[1] === null)).toBe(true);
  },
  30_000,
);

it.each(["build", "local-agent"] as const)(
  "retries admission when the implicit default changes to %s during preflight",
  async (defaultChatMode) => {
    writeSettings({
      enableDyadPro: true,
      defaultChatMode: defaultChatMode === "build" ? "local-agent" : "build",
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
    });
    await harness.db
      .update(chats)
      .set({ chatMode: null })
      .where(eq(chats.id, harness.chatId));
    h.account.mockImplementationOnce(async () => {
      writeSettings({ defaultChatMode });
      return { connected: true, models: ["gpt-5"] };
    });
    const result = await harness.streamChat(
      "Say hello without changing files.",
    );
    expect(h.account.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(h.credits).not.toHaveBeenCalled();
    expect(h.model).toHaveBeenCalled();
    expect(h.model.mock.calls.every((call) => call[1] === null)).toBe(true);
  },
  30_000,
);

it("accepts a provider-owned subscription turn without recording application quota usage", async () => {
  const result = await harness.streamChat("Say hello without changing files.");
  expect(result.eventsFor("chat:response:error")).toHaveLength(0);
  expect(h.model).toHaveBeenCalled();
  expect(h.credits).not.toHaveBeenCalled();
  const stored = await harness.db.select().from(messages);
  expect(
    stored.find((message) => message.role === "user")?.usingFreeAgentModeQuota,
  ).toBe(false);
  expect(
    stored.some(
      (message) =>
        message.role === "assistant" &&
        message.inferenceSource === "subscription",
    ),
  ).toBe(true);
}, 30_000);

it("does not let obsolete application quota simulation block provider-owned inference", async () => {
  vi.stubEnv("DYAD_SIMULATE_FREE_AGENT_QUOTA_EXCEEDED", "true");
  try {
    const result = await harness.streamChat(
      "This provider-owned turn should proceed.",
    );
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(h.model).toHaveBeenCalled();
    expect(h.credits).not.toHaveBeenCalled();
    const chat = await harness.db
      .select()
      .from(chats)
      .where(eq(chats.id, harness.chatId));
    expect(chat[0].chatMode).toBe("local-agent");
    expect((await harness.db.select().from(messages)).length).toBeGreaterThan(
      0,
    );
  } finally {
    vi.unstubAllEnvs();
  }
}, 30_000);
