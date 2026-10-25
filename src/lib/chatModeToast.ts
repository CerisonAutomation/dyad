import type { ChatMode } from "./schemas";

export function getChatModeDisplayName(
  mode: ChatMode,
  _legacyEntitlement: boolean,
): string {
  switch (mode) {
    case "build":
      return "Build";
    case "ask":
      return "Ask";
    case "local-agent":
      return "Agent2";
    case "plan":
      return "Plan";
  }
}
