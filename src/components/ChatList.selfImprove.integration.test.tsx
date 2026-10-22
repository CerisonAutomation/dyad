import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { apps, chats } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const SELF_IMPROVE_APP_NAME = "Dyad (self-improvement)";
const SELF_IMPROVE_CHAT_TITLE = "Dyad self-improvement (always open)";
const SELF_IMPROVE_CHAT_LABEL = "Dyad self-improvement · always open";

describe("ChatList self-improvement chat (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("pins the always-open self-improvement chat at the top of the chat list", async () => {
    const [selfImproveApp] = await harness.db
      .insert(apps)
      .values({
        name: SELF_IMPROVE_APP_NAME,
        path: "/tmp/dyad-self-improvement",
        isFavorite: true,
      })
      .returning();
    const [selfImproveChat] = await harness.db
      .insert(chats)
      .values({
        appId: selfImproveApp.id,
        title: SELF_IMPROVE_CHAT_TITLE,
        chatMode: "local-agent",
        isFavorite: true,
      })
      .returning();

    harness.mount({ withChatList: true });

    const listContainer = await screen.findByTestId("chat-list-container");
    const section = await screen.findByTestId("self-improve-chat-section");
    expect(within(section).getByText(SELF_IMPROVE_CHAT_LABEL)).toBeTruthy();
    expect(within(section).getByTestId("self-improve-chat-item")).toBeTruthy();

    // The pinned entry is the FIRST chat in the list: it precedes every
    // date group.
    const firstGroup = listContainer.querySelector(
      '[data-testid^="chat-group-"]',
    );
    if (firstGroup) {
      expect(
        section.compareDocumentPosition(firstGroup) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    // Clicking it opens the self-improvement chat.
    fireEvent.click(within(section).getByTestId("self-improve-chat-item"));
    expect(Number(harness.currentLocation().search.id)).toBe(
      selfImproveChat.id,
    );
  });
});
