import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { apps, chats } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerSelfHealHandlers } from "./self_heal_handlers";

const broadcast = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/window_broadcast", () => ({
  broadcastToAllWindows: broadcast,
  broadcastToRegisteredWindows: broadcast,
}));

const SELF_IMPROVE_APP_NAME = "Dyad (self-improvement)";
const SELF_IMPROVE_CHAT_TITLE = "Dyad self-improvement (always open)";

interface SelfImproveChatResult {
  appId: number;
  chatId: number;
  title: string;
  appPath: string;
}

describe("self-heal handlers", () => {
  let harness: HandlerTestHarness;
  let dyadRoot: string;

  beforeEach(async () => {
    dyadRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-self-heal-"),
    );
    // The self-improvement agent may only touch a real Dyad checkout.
    await fs.promises.writeFile(
      path.join(dyadRoot, "package.json"),
      JSON.stringify({ name: "dyad-self-heal-test" }),
      "utf-8",
    );
    process.env.DYAD_SOURCE_ROOT = dyadRoot;
    broadcast.mockClear();
    harness = setupHandlerTestHarness();
    registerSelfHealHandlers();
  });

  afterEach(async () => {
    harness.dispose();
    delete process.env.DYAD_SOURCE_ROOT;
    await fs.promises.rm(dyadRoot, { recursive: true, force: true });
  });

  it("has no self-improvement chat before it is created", async () => {
    const result = await harness.invokeHandler(
      "self-heal:get-self-improve-chat",
      undefined,
    );
    expect(result).toBeNull();
  });

  it("creates the pinned, always-open chat on the Dyad source root", async () => {
    const created = await harness.invokeHandler<SelfImproveChatResult>(
      "self-heal:ensure-self-improve-chat",
      undefined,
    );

    expect(created.title).toBe(SELF_IMPROVE_CHAT_TITLE);
    expect(created.appPath).toBe(dyadRoot);

    const appRow = await harness.db.query.apps.findFirst({
      where: eq(apps.name, SELF_IMPROVE_APP_NAME),
    });
    expect(appRow?.path).toBe(dyadRoot);
    expect(appRow?.isFavorite).toBe(true);

    const chatRow = await harness.db.query.chats.findFirst({
      where: eq(chats.id, created.chatId),
    });
    // The chat is PINNED so the chat list can surface it without a schema
    // change, and it runs in local-agent mode.
    expect(chatRow?.isFavorite).toBe(true);
    expect(chatRow?.chatMode).toBe("local-agent");
    expect(chatRow?.appId).toBe(created.appId);

    const fetched = await harness.invokeHandler<SelfImproveChatResult | null>(
      "self-heal:get-self-improve-chat",
      undefined,
    );
    expect(fetched).toMatchObject({
      appId: created.appId,
      chatId: created.chatId,
      title: SELF_IMPROVE_CHAT_TITLE,
    });
  });

  it("requests a run over the run-requested event", async () => {
    const created = await harness.invokeHandler<SelfImproveChatResult>(
      "self-heal:ensure-self-improve-chat",
      undefined,
    );

    const result = await harness.invokeHandler<{
      ran: boolean;
      reason: string;
    }>("self-heal:run-now", undefined);
    expect(result.ran).toBe(true);

    expect(broadcast).toHaveBeenCalledTimes(1);
    const [channel, payload] = broadcast.mock.calls[0] as [
      string,
      { chatId: number; appId: number; prompt: string },
    ];
    expect(channel).toBe("self-heal:run-requested");
    expect(payload.chatId).toBe(created.chatId);
    expect(payload.appId).toBe(created.appId);
    expect(payload.prompt.length).toBeGreaterThan(0);
  });
});
