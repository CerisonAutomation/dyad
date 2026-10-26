import { createHash } from "node:crypto";

/** Turn-local, bounded and digest-only: never retains source, credentials or tool output. */
export class ToolLoopGuard {
  private readonly attempts = new Map<
    string,
    { outcome: string; count: number; failed: boolean; mutation: boolean }
  >();
  private key(name: string, args: unknown): string | null {
    try {
      const canonical = JSON.stringify(args, (_key, value) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          );
        }
        return value;
      });
      if (!canonical || canonical.length > 2_000_000) return null;
      return name + ":" + createHash("sha256").update(canonical).digest("hex");
    } catch {
      return null;
    }
  }
  assertAllowed(name: string, args: unknown): void {
    const key = this.key(name, args);
    const prior = key ? this.attempts.get(key) : undefined;
    if (prior && prior.count >= 3 && (prior.failed || prior.mutation)) {
      throw new Error(
        `Loop protection: '${name}' returned the same ${prior.failed ? "error" : "mutation result"} three times for unchanged arguments. Inspect diagnostics, make a relevant correction, change approach, or report the blocker. Do not repeat this unchanged action.`,
      );
    }
  }
  record(
    name: string,
    args: unknown,
    outcome: string,
    failed: boolean,
    mutation: boolean,
  ): void {
    const key = this.key(name, args);
    if (!key) return;
    const digest = createHash("sha256").update(outcome).digest("hex");
    const prior = this.attempts.get(key);
    const same = prior?.outcome === digest && prior.failed === failed;
    // A different successful mutation is evidence of progress; allow failed
    // checks to run again after a fix, not merely after another diagnostic read.
    if (!failed && mutation && !same) {
      for (const [id, value] of this.attempts)
        if (value.failed) this.attempts.delete(id);
    }
    this.attempts.delete(key);
    this.attempts.set(key, {
      outcome: digest,
      count: same ? prior.count + 1 : 1,
      failed,
      mutation,
    });
    if (this.attempts.size > 64)
      this.attempts.delete(this.attempts.keys().next().value!);
  }
}
