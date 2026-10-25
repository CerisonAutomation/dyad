import { expect, it } from "vitest";
import { remainingGoalSteps } from "./goal_runtime_budget";
it("retries and continuation share the remaining allowance", () => {
  expect(remainingGoalSteps(10, 3)).toBe(7);
  expect(remainingGoalSteps(10, 8)).toBe(2);
  expect(remainingGoalSteps(10, 10)).toBe(0);
  expect(remainingGoalSteps(10, 11)).toBe(0);
});
it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid budget %s", (limit) => {
  expect(() => remainingGoalSteps(limit, 0)).toThrow();
});
it("rejects invalid accounting", () => {
  expect(() => remainingGoalSteps(10, -1)).toThrow();
});
