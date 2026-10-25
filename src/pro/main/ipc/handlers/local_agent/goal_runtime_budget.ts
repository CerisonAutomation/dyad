/** A turn-wide budget: retries and todo continuation must not reset the allowance. */
export function remainingGoalSteps(limit: number, executed: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(executed) ||
    executed < 0
  ) {
    throw new Error(
      "Goal runtime requires a positive integer limit and nonnegative executed count",
    );
  }
  return Math.max(0, limit - executed);
}
