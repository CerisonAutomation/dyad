import { expect, it } from "vitest";
import { getChatModeDisplayName } from "./chatModeToast";
it.each([true, false])(
  "names the provider-backed agent consistently regardless of old entitlement=%s",
  (oldEntitlement) => {
    expect(getChatModeDisplayName("local-agent", oldEntitlement)).toBe(
      "Agent2",
    );
  },
);
it("preserves the read-only and planning mode labels", () => {
  expect(getChatModeDisplayName("ask", false)).toBe("Ask");
  expect(getChatModeDisplayName("plan", false)).toBe("Plan");
});
