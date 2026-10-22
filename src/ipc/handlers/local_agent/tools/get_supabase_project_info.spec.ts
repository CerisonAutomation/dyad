import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseManagementAPIError } from "@dyad-sh/supabase-management-js";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const mocks = vi.hoisted(() => ({
  getSupabaseProjectInfoMock: vi.fn(),
}));

vi.mock("../../../../supabase_admin/supabase_context", () => ({
  getSupabaseProjectInfo: mocks.getSupabaseProjectInfoMock,
}));

import { getSupabaseProjectInfoTool } from "./get_supabase_project_info";
import type { AgentContext } from "./types";

function supabaseContext(): AgentContext {
  return {
    appPath: "/tmp/app",
    supabaseProjectId: "supabase-project",
    supabaseOrganizationSlug: "supabase-org",
    supabaseProviderToolsAvailable: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext;
}

describe("getSupabaseProjectInfoTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies a Management API 401 as an auth failure", async () => {
    mocks.getSupabaseProjectInfoMock.mockRejectedValue(
      new SupabaseManagementAPIError(
        "Failed to get secrets: Unauthorized (401)",
        new Response(null, { status: 401 }),
      ),
    );

    await expect(
      getSupabaseProjectInfoTool.execute({}, supabaseContext()),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
  });

  it("classifies other Management API failures as external", async () => {
    mocks.getSupabaseProjectInfoMock.mockRejectedValue(
      new SupabaseManagementAPIError(
        "Failed to get secrets: Internal Server Error (500)",
        new Response(null, { status: 500 }),
      ),
    );

    await expect(
      getSupabaseProjectInfoTool.execute({}, supabaseContext()),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
    });
  });

  it("keeps an already-classified error", async () => {
    const original = new DyadError("nope", DyadErrorKind.Precondition);
    mocks.getSupabaseProjectInfoMock.mockRejectedValue(original);

    await expect(
      getSupabaseProjectInfoTool.execute({}, supabaseContext()),
    ).rejects.toBe(original);
  });
});
