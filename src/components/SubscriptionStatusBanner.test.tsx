import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SubscriptionStatusBanner } from "./SubscriptionStatusBanner";
const requests = vi.hoisted(() => ({ billing: vi.fn(), budget: vi.fn() }));
vi.mock("@/hooks/useSubscriptionStatus", () => ({
  useSubscriptionStatus: requests.billing,
}));
vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: requests.budget,
}));
it("does not display or request retired application billing", () => {
  const { container } = render(<SubscriptionStatusBanner />);
  expect(container.firstChild).toBeNull();
  expect(requests.billing).not.toHaveBeenCalled();
  expect(requests.budget).not.toHaveBeenCalled();
});
