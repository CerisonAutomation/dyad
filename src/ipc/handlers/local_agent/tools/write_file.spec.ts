import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileTool } from "./write_file";
import { deploySupabaseFunction } from "../../../../supabase_admin/supabase_management_client";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

vi.mock("../../../../supabase_admin/supabase_management_client", () => ({
  deploySupabaseFunction: vi.fn(),
}));

describe("writeFileTool", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-write-file-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  function context() {
    return {
      appId: 1,
      appPath,
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    } as any;
  }

  it("names the skipped deploy when the path is not a deployable function", async () => {
    const result = await writeFileTool.execute(
      {
        path: "supabase/functions/_x/util.ts",
        content: "export const x = 1;",
      },
      context(),
    );

    expect(result).toContain(
      "Successfully wrote supabase/functions/_x/util.ts",
    );
    expect(result).toContain("skipped the Supabase function deployment");
    expect(deploySupabaseFunction).not.toHaveBeenCalled();
    await expect(
      fs.readFile(path.join(appPath, "supabase/functions/_x/util.ts"), "utf8"),
    ).resolves.toBe("export const x = 1;");
  });
});
