import { isAgent2Enabled, type UserSettings } from "@/lib/schemas";

/** Use the resolved turn mode, not the user's default mode, for chat requests. */
export function shouldBillChatGPTSubscription(settings: UserSettings): boolean {
  return (
    isAgent2Enabled(settings) &&
    settings.selectedChatMode !== "build" &&
    settings.selectedChatMode !== "ask" &&
    settings.selectedChatMode !== "plan"
  );
}
