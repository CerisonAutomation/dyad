import { randomUUID } from "node:crypto";
import { v5 as uuidv5 } from "uuid";

/** OpenCode's routing ID is conversation-scoped, not a request ID or API key. */
export function getOpenCodeHeaders(
  baseURL: string,
  namespace: string | undefined,
  chatId?: number | string,
): Record<string, string> | undefined {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "opencode.ai" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/zen\/(?:go\/)?v1\/?$/.test(url.pathname)
  )
    return undefined;
  // Hash the installation namespace: never transmit the telemetry ID itself.
  // Unknown/detached conversations get one UUID per model client, retained for
  // all retries/steps of that operation, never a global shared session.
  const session =
    namespace &&
    ((typeof chatId === "number" &&
      Number.isSafeInteger(chatId) &&
      chatId >= 0) ||
      (typeof chatId === "string" && chatId.trim().length > 0))
      ? uuidv5(
          JSON.stringify(["agent2-opencode", namespace, chatId]),
          uuidv5.URL,
        )
      : randomUUID();
  return {
    "x-opencode-session": session,
    "x-opencode-client": "agent2",
    "User-Agent": "Agent2",
  };
}

/** Apply at fetch time: AI SDK request headers otherwise replace provider UA. */
export function withOpenCodeHeaders(
  fetcher: typeof fetch,
  required: Record<string, string>,
): typeof fetch {
  return async (input, init) => {
    const destination = new URL(
      input instanceof Request ? input.url : String(input),
    );
    if (
      destination.protocol !== "https:" ||
      destination.hostname !== "opencode.ai" ||
      destination.port ||
      destination.username ||
      destination.password ||
      !/^\/zen\/(?:go\/)?v1(?:\/|$)/.test(destination.pathname)
    ) {
      throw new Error(
        "OpenCode transport refused an unexpected inference destination",
      );
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    for (const [name, value] of Object.entries(required)) {
      if (name.toLowerCase() === "user-agent") {
        const sdkAgent = headers.get(name);
        headers.set(
          name,
          sdkAgent?.startsWith(value)
            ? sdkAgent
            : sdkAgent
              ? `${value} ${sdkAgent}`
              : value,
        );
      } else headers.set(name, value);
    }
    // Never forward routing identity or credentials through an HTTP redirect.
    return fetcher(input, { ...init, headers, redirect: "error" });
  };
}
