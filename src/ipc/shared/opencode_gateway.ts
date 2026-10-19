/**
 * OpenCode Zen gateway — per-model wire-protocol routing.
 *
 * The gateway is not a single OpenAI-compatible endpoint. It multiplexes three
 * different wire protocols behind one host, and which one a given model speaks
 * is a property of the model, not of the gateway:
 *
 *   /v1/chat/completions  -> @ai-sdk/openai-compatible  (OpenAI Chat Completions)
 *   /v1/responses         -> @ai-sdk/openai             (OpenAI Responses API)
 *   /v1/messages          -> @ai-sdk/anthropic          (Anthropic Messages API)
 *
 * Sending every model through `createOpenAICompatible` - which is what the
 * single `case "opencode"` branch used to do - works only for the
 * chat/completions third. The Responses and Messages models get a 404 from the
 * wrong path.
 *
 * The three AI SDK factories each take a `baseURL` and append their own path,
 * so all three point at the same gateway root and differ only in factory.
 */

import { OPENCODE_BASE_URL } from "./provider_registry";
import { protocolForOwnedBy } from "./opencode_model_discovery";

// Declared in the provider registry so OpenCode's endpoint sits next to every
// other provider's, and re-exported here for the modules that already import it
// from the gateway.
export { OPENCODE_BASE_URL };
export const OPENCODE_MODELS_URL = `${OPENCODE_BASE_URL}/models`;

/**
 * OpenCode Zen requires a stable per-conversation session ID so inference can
 * be routed (and cached) efficiently. The gateway rejects calls that omit it:
 * "Request is missing x-opencode-session and cannot be routed efficiently."
 *
 * The value is opaque client-generated state, not a credential. Use one stable
 * ID per conversation and send it on every OpenCode inference call. Switching
 * conversation must switch sessions, otherwise unrelated turns share routing
 * and cache context.
 */
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

/**
 * Whether a base URL points at the OpenCode Zen gateway.
 *
 * Users can reach OpenCode either through the built-in `opencode` provider or
 * by adding OpenCode Zen as a custom provider. Both are the same gateway and
 * need the same session header and per-model protocol routing, so the gateway
 * is recognised by host rather than by provider id.
 */
export function isOpenCodeBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).host === new URL(OPENCODE_BASE_URL).host;
  } catch {
    return false;
  }
}

/**
 * Session ID for a Dyad conversation.
 *
 * Derived from the chat id instead of generated randomly so it survives app
 * restarts: a random ID would silently split one conversation into a fresh
 * routing/cache session on every launch, which is the opposite of what the
 * gateway asks for.
 *
 * Requests that belong to no conversation (one-off utility calls) share the
 * unscoped fallback rather than omitting the header, because omitting it fails
 * the request outright.
 */
export function openCodeSessionIdForChat(
  chatId: number | string | null | undefined,
): string {
  const normalized = chatId == null ? "" : String(chatId).trim();
  return normalized === "" ? "dyad-chat-unscoped" : `dyad-chat-${normalized}`;
}

export type OpenCodeProtocol = "chat-completions" | "responses" | "messages";

export interface OpenCodeRoute {
  /** Path segment appended to OPENCODE_BASE_URL. */
  readonly path: "/chat/completions" | "/responses" | "/messages";
  /** Which AI SDK factory builds the client. */
  readonly protocol: OpenCodeProtocol;
  readonly displayName: string;
}

const CHAT = "/chat/completions" as const;
const RESPONSES = "/responses" as const;
const MESSAGES = "/messages" as const;

/**
 * Authoritative model -> protocol map.
 *
 * Unknown models default to chat/completions, which is the gateway's own
 * default and the only protocol we can assume without being told otherwise.
 */
export const OPENCODE_ROUTES: Readonly<Record<string, OpenCodeRoute>> = {
  // --- OpenAI Responses API ---
  "grok-4.7": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "Grok 4.7",
  },
  "grok-4.6": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "Grok 4.6",
  },
  "gpt-6-luna": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "GPT 6 Luna",
  },
  "gpt-5.6-luna": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "GPT 5.6 Luna",
  },
  "muse-spark-1.3-contributor": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "Muse Spark 1.3 Contributor",
  },
  "muse-spark-1.2-contributor": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "Muse Spark 1.2 Contributor",
  },

  // --- OpenAI Chat Completions ---
  "glm-5.3-flash": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "GLM-5.3-Flash",
  },
  "glm-5.3": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "GLM-5.3",
  },
  "glm-5.2": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "GLM-5.2",
  },
  "kimi-k3": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Kimi K3",
  },
  "kimi-k2.7-code": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Kimi K2.7 Code",
  },
  "kimi-k2.6": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Kimi K2.6",
  },
  "longcat-2.0": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "LongCat-2.0",
  },
  "deepseek-v4.1-flash": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "DeepSeek V4.1 Flash",
  },
  "deepseek-v4-pro": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "DeepSeek V4 Pro",
  },
  "deepseek-v4-flash": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "DeepSeek V4 Flash",
  },
  "deepseek-v4-flash-vision-exp": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "DeepSeek V4 Flash Vision Exp",
  },
  "mimo-v2.6-flash": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "MiMo-V2.6-Flash",
  },
  "mimo-v2.6-pro": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "MiMo-V2.6-Pro",
  },
  "mimo-v2.5": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "MiMo-V2.5",
  },
  "mimo-v2.5-pro": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "MiMo-V2.5-Pro",
  },
  "hy4-preview": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Hy4 preview",
  },
  hy3: { path: CHAT, protocol: "chat-completions", displayName: "Hy3" },
  "hy3-preview": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Hy3 Preview",
  },
  "kimi-k2.5": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Kimi K2.5",
  },
  "glm-5.1": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "GLM-5.1",
  },
  "glm-5": { path: CHAT, protocol: "chat-completions", displayName: "GLM-5" },
  "deepseek-flash": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "DeepSeek Flash",
  },
  "mimo-v2-pro": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "MiMo-V2-Pro",
  },
  "mimo-v2-omni": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "MiMo-V2-Omni",
  },
  "grok-4.5": {
    path: RESPONSES,
    protocol: "responses",
    displayName: "Grok 4.5",
  },
  "space-bunny": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Space Bunny",
  },
  "longcat-2.5-preview-free": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "LongCat 2.5 Preview Free",
  },

  // --- Anthropic Messages API ---
  "minimax-m3": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "minimax M3",
  },
  "minimax-m2.7": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "minimax M2.7",
  },
  "minimax-m2.5": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "minimax M2.5",
  },
  "qwen3.8-max": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "Qwen3.8 Max",
  },
  "qwen3.8-flash": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "Qwen3.8 Flash",
  },
  "qwen3.7-max": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "Qwen3.7 Max",
  },
  "qwen3.7-plus": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "Qwen3.7 Plus",
  },
  "qwen3.6-plus": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "Qwen3.6 Plus",
  },
  "qwen3.5-plus": {
    path: MESSAGES,
    protocol: "messages",
    displayName: "Qwen3.5 Plus",
  },
  "omen-alpha": {
    path: CHAT,
    protocol: "chat-completions",
    displayName: "Omen Alpha",
  },
};

const DEFAULT_ROUTE: OpenCodeRoute = {
  path: CHAT,
  protocol: "chat-completions",
  displayName: "",
};

/**
 * Resolve how a given model id must be reached.
 *
 * The hardcoded OPENCODE_ROUTES map is the primary source — it encodes what we
 * know about each model's protocol from direct testing. For models the map
 * doesn't cover (the gateway adds new ones without notice), the `owned_by`
 * value from the gateway's `/models` response tells us which upstream serves
 * the model, and we can infer the protocol from that.
 */
export function getOpenCodeRoute(
  modelName: string,
  ownedBy?: string | null,
): OpenCodeRoute {
  const known = OPENCODE_ROUTES[modelName];
  if (known) return known;

  if (ownedBy) {
    const protocol = protocolForOwnedBy(ownedBy);
    if (protocol === "messages") {
      return { path: MESSAGES, protocol: "messages", displayName: "" };
    }
    if (protocol === "responses") {
      return { path: RESPONSES, protocol: "responses", displayName: "" };
    }
  }

  return DEFAULT_ROUTE;
}

export function listOpenCodeRoutes(): Array<
  { modelId: string } & OpenCodeRoute
> {
  return Object.entries(OPENCODE_ROUTES).map(([modelId, route]) => ({
    modelId,
    ...route,
  }));
}
