import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveUnsettledThreadStatus } from "./subagent_manager";

const managerSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "src/ipc/handlers/local_agent/subagents/subagent_manager.ts",
  ),
  "utf8",
);

describe("sub-agent run settlement", () => {
  it("settles a thread that is still active when its run ends", () => {
    expect(resolveUnsettledThreadStatus("running")).toBe("cancelled");
    expect(resolveUnsettledThreadStatus("queued")).toBe("cancelled");
    expect(resolveUnsettledThreadStatus("stopping")).toBe("cancelled");
  });

  it("leaves an already finished thread alone", () => {
    expect(resolveUnsettledThreadStatus("completed")).toBeNull();
    expect(resolveUnsettledThreadStatus("partial")).toBeNull();
    expect(resolveUnsettledThreadStatus("cancelled")).toBeNull();
    expect(resolveUnsettledThreadStatus("interrupted_by_restart")).toBeNull();
  });

  it("never lets an aborted run return without settling its thread", () => {
    // An aborted run used to return early, leaving the row "running" or
    // "queued" until the next app restart.
    expect(managerSource).not.toContain(
      "if (controller.signal.aborted) return;",
    );
    // Both sub-agent run paths (implementer/explorer and reviewer) must settle
    // their thread, in the aborted branch and in the finally backstop.
    const settlements = managerSource.match(
      /await settleThreadIfStillActive\(threadId\);/g,
    );
    expect(settlements?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
