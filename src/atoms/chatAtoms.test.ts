import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  agentTodosByChatIdAtom,
  chatMessagesByIdAtom,
  removeChatIdFromAllTrackingAtom,
} from "@/atoms/chatAtoms";
import { planAnnotationsAtom, planStateAtom } from "@/atoms/planAtoms";
import { appBlueprintStateAtom } from "@/atoms/appBlueprintAtoms";

/**
 * The renderer keeps a cached copy of every chat it has opened. When a chat is
 * deleted those caches must be released, otherwise the transcript of every
 * chat ever visited stays resident for the life of the window.
 */
describe("removeChatIdFromAllTrackingAtom", () => {
  it("drops the cached message transcript of the deleted chat", () => {
    const store = createStore();
    store.set(chatMessagesByIdAtom, new Map([[1, [{ id: "m1" } as any]]]));
    store.set(
      chatMessagesByIdAtom,
      new Map([...store.get(chatMessagesByIdAtom), [2, [{ id: "m2" } as any]]]),
    );

    store.set(removeChatIdFromAllTrackingAtom, 1);

    const remaining = store.get(chatMessagesByIdAtom);
    expect(remaining.has(1)).toBe(false);
    expect(remaining.has(2)).toBe(true);
  });

  it("drops the cached plan, its acceptance flag and the plan annotations", () => {
    const store = createStore();
    store.set(planStateAtom, {
      plansByChatId: new Map([
        [1, { content: "plan", title: "t", summary: "s" }],
      ]),
      acceptedChatIds: new Set([1]),
    });
    store.set(
      planAnnotationsAtom,
      new Map([[1, [{ id: "a1", selectedText: "x", comment: "y" } as any]]]),
    );

    store.set(removeChatIdFromAllTrackingAtom, 1);

    const planState = store.get(planStateAtom);
    expect(planState.plansByChatId.has(1)).toBe(false);
    expect(planState.acceptedChatIds.has(1)).toBe(false);
    expect(store.get(planAnnotationsAtom).has(1)).toBe(false);
  });

  it("drops the cached app blueprint and its approval/timeout flags", () => {
    const store = createStore();
    store.set(appBlueprintStateAtom, {
      plansByChatId: new Map([[1, { content: "blueprint" } as any]]),
      approvedChatIds: new Set([1]),
      timedOutChatIds: new Set([1]),
    });

    store.set(removeChatIdFromAllTrackingAtom, 1);

    const blueprintState = store.get(appBlueprintStateAtom);
    expect(blueprintState.plansByChatId.has(1)).toBe(false);
    expect(blueprintState.approvedChatIds.has(1)).toBe(false);
    expect(blueprintState.timedOutChatIds.has(1)).toBe(false);
  });

  it("drops the agent todos of the deleted chat", () => {
    const store = createStore();
    store.set(
      agentTodosByChatIdAtom,
      new Map([[1, [{ content: "todo", status: "pending" } as any]]]),
    );

    store.set(removeChatIdFromAllTrackingAtom, 1);

    expect(store.get(agentTodosByChatIdAtom).has(1)).toBe(false);
  });

  it("leaves other chats untouched", () => {
    const store = createStore();
    store.set(
      chatMessagesByIdAtom,
      new Map([
        [1, [{ id: "m1" } as any]],
        [2, [{ id: "m2" } as any]],
      ]),
    );

    store.set(removeChatIdFromAllTrackingAtom, 1);

    expect(store.get(chatMessagesByIdAtom).get(2)).toHaveLength(1);
  });
});
