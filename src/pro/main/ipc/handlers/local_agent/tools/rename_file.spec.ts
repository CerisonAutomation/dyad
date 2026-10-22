import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renameFileTool } from "./rename_file";
import {
  deploySupabaseFunction,
  deleteSupabaseFunction,
} from "../../../../../../supabase_admin/supabase_management_client";

const { gitAdd, gitRemove } = vi.hoisted(() => ({
  gitAdd: vi.fn(),
  gitRemove: vi.fn(),
}));

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

vi.mock("@/ipc/utils/git_utils", () => ({ gitAdd, gitRemove }));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  deploySupabaseFunction: vi.fn(),
  deleteSupabaseFunction: vi.fn(),
}));

describe("renameFileTool", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-rename-file-"));
    vi.clearAllMocks();
    gitAdd.mockResolvedValue(undefined);
    gitRemove.mockResolvedValue(undefined);
    // The tool ignores the deployment response, so the mock can stay empty.
    vi.mocked(deploySupabaseFunction).mockResolvedValue(undefined as never);
    vi.mocked(deleteSupabaseFunction).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  function context() {
    return {
      appId: 1,
      appPath,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    } as any;
  }

  it("reports a failed git stage without failing the completed rename", async () => {
    await fs.writeFile(path.join(appPath, "source.ts"), "source");
    gitAdd.mockRejectedValueOnce(new Error("git add failed"));

    const result = await renameFileTool.execute(
      { from: "source.ts", to: "destination.ts" },
      context(),
    );

    expect(result).toBe(
      "Successfully renamed source.ts to destination.ts but failed to stage it in git: git add failed",
    );
    await expect(
      fs.readFile(path.join(appPath, "destination.ts"), "utf8"),
    ).resolves.toBe("source");
  });

  it("still reconciles the Supabase function after a failed git stage", async () => {
    await fs.mkdir(path.join(appPath, "supabase", "functions", "hello"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "supabase", "functions", "hello2"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "supabase", "functions", "hello", "index.ts"),
      "export default () => {};",
    );
    gitAdd.mockRejectedValueOnce(new Error("git add failed"));

    const result = await renameFileTool.execute(
      {
        from: "supabase/functions/hello/index.ts",
        to: "supabase/functions/hello2/index.ts",
      },
      { ...context(), supabaseProjectId: "project-id" },
    );

    expect(result).toContain("but failed to stage it in git: git add failed");
    expect(deleteSupabaseFunction).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "hello" }),
    );
    expect(deploySupabaseFunction).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "hello2" }),
    );
  });
});
