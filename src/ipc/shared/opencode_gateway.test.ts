import { describe, it, expect } from "vitest";
import {
  OPENCODE_ROUTES,
  OPENCODE_BASE_URL,
  OPENCODE_SESSION_HEADER,
  getOpenCodeRoute,
  listOpenCodeRoutes,
  openCodeSessionIdForChat,
} from "./opencode_gateway";

describe("opencode_gateway routing", () => {
  it("exposes the gateway root without a trailing path", () => {
    expect(OPENCODE_BASE_URL).toBe("https://opencode.ai/zen/go/v1");
  });

  it("routes Responses-API models to /responses", () => {
    for (const id of [
      "grok-4.7",
      "grok-4.6",
      "gpt-6-luna",
      "gpt-5.6-luna",
      "muse-spark-1.3-contributor",
      "muse-spark-1.2-contributor",
    ]) {
      expect(getOpenCodeRoute(id)).toMatchObject({
        path: "/responses",
        protocol: "responses",
      });
    }
  });

  it("routes Messages-API models to /messages", () => {
    for (const id of [
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "qwen3.8-max",
      "qwen3.8-flash",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-plus",
      "qwen3.5-plus",
    ]) {
      expect(getOpenCodeRoute(id)).toMatchObject({
        path: "/messages",
        protocol: "messages",
      });
    }
  });

  it("routes the remaining models to /chat/completions", () => {
    for (const id of [
      "glm-5.3-flash",
      "glm-5.3",
      "glm-5.2",
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "longcat-2.0",
      "deepseek-v4.1-flash",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "mimo-v2.6-flash",
      "mimo-v2.6-pro",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "mimo-v2-pro",
      "mimo-v2-omni",
      "hy4-preview",
      "hy3",
      "hy3-preview",
      "glm-5.1",
      "glm-5",
      "kimi-k2.5",
      "deepseek-flash",
      "space-bunny",
      "longcat-2.5-preview-free",
      "omen-alpha",
    ]) {
      expect(getOpenCodeRoute(id)).toMatchObject({
        path: "/chat/completions",
        protocol: "chat-completions",
      });
    }
  });

  it("routes grok-4.5 to the Responses API like its siblings", () => {
    expect(getOpenCodeRoute("grok-4.5")).toMatchObject({
      path: "/responses",
      protocol: "responses",
    });
  });

  it("covers all 43 live gateway models", () => {
    expect(listOpenCodeRoutes()).toHaveLength(43);
    expect(Object.keys(OPENCODE_ROUTES)).toHaveLength(43);
  });

  it("tracks the live gateway: no stale or missing ids", () => {
    const live = [
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "longcat-2.0",
      "kimi-k2.5",
      "glm-5.2",
      "glm-5.3-flash",
      "glm-5.3",
      "glm-5.1",
      "glm-5",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-flash",
      "deepseek-v4.1-flash",
      "deepseek-v4-flash-vision-exp",
      "qwen3.7-max",
      "qwen3.8-max",
      "qwen3.8-flash",
      "qwen3.7-plus",
      "qwen3.6-plus",
      "qwen3.5-plus",
      "mimo-v2-pro",
      "mimo-v2-omni",
      "mimo-v2.6-pro",
      "mimo-v2.6-flash",
      "longcat-2.5-preview-free",
      "mimo-v2.5-pro",
      "mimo-v2.5",
      "hy4-preview",
      "hy3",
      "hy3-preview",
      "gpt-5.6-luna",
      "grok-4.5",
      "grok-4.7",
      "grok-4.6",
      "muse-spark-1.3-contributor",
      "muse-spark-1.2-contributor",
      "omen-alpha",
      "gpt-6-luna",
      "space-bunny",
    ];
    const routed = listOpenCodeRoutes().map((r) => r.modelId);
    expect(routed.sort()).toEqual(live.sort());
  });

  it("falls back to chat/completions for an unknown model", () => {
    expect(getOpenCodeRoute("some-future-model")).toMatchObject({
      path: "/chat/completions",
      protocol: "chat-completions",
    });
  });

  it("gives every routed model a display name", () => {
    for (const route of listOpenCodeRoutes()) {
      expect(route.displayName.length).toBeGreaterThan(0);
    }
  });

  it("does not mix up near-identical ids", () => {
    // Regression guard: the vision variant must not inherit the plain model's
    // route by prefix, and k2.7-code must stay on chat/completions.
    expect(getOpenCodeRoute("deepseek-v4-flash-vision-exp").path).toBe(
      "/chat/completions",
    );
    expect(getOpenCodeRoute("kimi-k2.7-code").path).toBe("/chat/completions");
    // grok-4.5 is an explicit Responses-API model, like its 4.6/4.7 siblings.
    expect(getOpenCodeRoute("grok-4.5").path).toBe("/responses");
  });
});

describe("opencode_gateway session ids", () => {
  it("guards the exact header name the gateway requires", () => {
    expect(OPENCODE_SESSION_HEADER).toBe("x-opencode-session");
  });

  it("derives the session from the chat id", () => {
    expect(openCodeSessionIdForChat(42)).toBe("dyad-chat-42");
  });

  it("keeps one conversation on one session", () => {
    // Stability is the whole point: routing and prompt caching only hold if
    // every turn of a conversation sends the same value.
    expect(openCodeSessionIdForChat(42)).toBe(openCodeSessionIdForChat(42));
  });

  it("separates different conversations", () => {
    expect(openCodeSessionIdForChat(1)).not.toBe(openCodeSessionIdForChat(2));
  });

  it("still yields a session when the request belongs to no conversation", () => {
    // A missing header fails the request outright, so no-chat calls share a
    // fallback rather than sending nothing.
    for (const empty of [undefined, null, "", "   "]) {
      expect(openCodeSessionIdForChat(empty)).toBe("dyad-chat-unscoped");
    }
  });
});
