import { describe, expect, it } from "vitest";

import { beginNewChat, endNewChat } from "./new_chat_lock";

describe("new_chat_lock", () => {
  it("rejects a concurrent second new chat and releases after the first finishes", () => {
    expect(beginNewChat()).toBe(true);
    expect(beginNewChat()).toBe(false);
    endNewChat();
    expect(beginNewChat()).toBe(true);
    endNewChat();
  });
});
