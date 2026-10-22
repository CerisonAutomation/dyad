import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSqlTool } from "./execute_sql";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const mocks = vi.hoisted(() => ({
  executeSupabaseSqlMock: vi.fn(),
  executeNeonSqlMock: vi.fn(),
  writeMigrationFileMock: vi.fn(),
  readSettingsMock: vi.fn(),
}));

vi.mock("../../../../supabase_admin/supabase_management_client", () => ({
  executeSupabaseSql: mocks.executeSupabaseSqlMock,
}));

vi.mock("../../../../neon_admin/neon_context", () => ({
  executeNeonSql: mocks.executeNeonSqlMock,
}));

vi.mock("../../../utils/file_utils", () => ({
  writeMigrationFile: mocks.writeMigrationFileMock,
}));

vi.mock("../../../../main/settings", () => ({
  readSettings: mocks.readSettingsMock,
}));

describe("executeSqlTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeSupabaseSqlMock.mockResolvedValue("[]");
    mocks.writeMigrationFileMock.mockResolvedValue(
      "supabase/migrations/0000_test.sql",
    );
    mocks.readSettingsMock.mockReturnValue({
      enableSupabaseWriteSqlMigration: true,
    });
  });

  it("fails closed when retained provider associations are unauthenticated", () => {
    expect(
      executeSqlTool.isEnabled?.({
        supabaseProjectId: "project",
      } as any),
    ).toBe(false);
    expect(
      executeSqlTool.isEnabled?.({
        supabaseProjectId: "project",
        supabaseProviderToolsAvailable: false,
      } as any),
    ).toBe(false);
    expect(
      executeSqlTool.isEnabled?.({
        neonProjectId: "project",
        neonActiveBranchId: "branch",
        neonProviderToolsAvailable: false,
      } as any),
    ).toBe(false);
  });

  it("marks mutating SQL in consent metadata", () => {
    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "CREATE TABLE users (id bigint);",
      }),
    ).toEqual({ sqlMutatesSchema: true, sqlDeletesData: false });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "SELECT * FROM users;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: false });
  });

  it("marks data-deleting SQL in consent metadata", () => {
    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "DELETE FROM users WHERE id = 1;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "UPDATE users SET email = NULL;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "DROP TABLE users;",
      }),
    ).toEqual({ sqlMutatesSchema: true, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query:
          "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "DO $$ BEGIN DELETE FROM users; END $$;",
      }),
    ).toEqual({ sqlMutatesSchema: true, sqlDeletesData: true });
  });

  it("returns the full query as the consent preview", () => {
    const query = "a".repeat(5000);
    expect(executeSqlTool.getConsentPreview?.({ query })).toBe(query);
  });

  it("writes a Supabase migration file for schema-mutating SQL", async () => {
    const result = await executeSqlTool.execute(
      {
        query: "CREATE TABLE users (id bigint);",
        description: "create users",
      },
      {
        appPath: "/app",
        supabaseProjectId: "project",
        supabaseOrganizationSlug: "org",
        supabaseProviderToolsAvailable: true,
      } as any,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith({
      supabaseProjectId: "project",
      query: "CREATE TABLE users (id bigint);",
      organizationSlug: "org",
    });
    expect(mocks.writeMigrationFileMock).toHaveBeenCalledWith(
      "/app",
      "CREATE TABLE users (id bigint);",
      "create users",
    );
    expect(result).toContain("wrote a migration file");
    expect(
      executeSqlTool.shouldTrackFileMutation?.(
        { query: "CREATE TABLE users (id bigint);" },
        result,
        {} as any,
      ),
    ).toBe(true);
  });

  it("forwards the turn abort signal to the SQL execution", async () => {
    // Without the signal, a cancelled turn leaves the statement and its retry
    // loop running against the project.
    const controller = new AbortController();
    await executeSqlTool.execute(
      {
        query: "SELECT * FROM users;",
        description: "lookup users",
      },
      {
        appPath: "/app",
        supabaseProjectId: "project",
        supabaseOrganizationSlug: "org",
        supabaseProviderToolsAvailable: true,
        abortSignal: controller.signal,
      } as any,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("skips Supabase migration files for non-schema SQL", async () => {
    const result = await executeSqlTool.execute(
      {
        query: "SELECT * FROM users;",
        description: "lookup users",
      },
      {
        appPath: "/app",
        supabaseProjectId: "project",
        supabaseOrganizationSlug: null,
        supabaseProviderToolsAvailable: true,
      } as any,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith({
      supabaseProjectId: "project",
      query: "SELECT * FROM users;",
      organizationSlug: null,
    });
    expect(mocks.writeMigrationFileMock).not.toHaveBeenCalled();
    expect(result).toBe("Successfully executed SQL query.\n\nSQL result:\n[]");
    expect(
      executeSqlTool.shouldTrackFileMutation?.(
        { query: "SELECT * FROM users;" },
        result,
        {} as any,
      ),
    ).toBe(false);
    expect(
      executeSqlTool.shouldTrackMutation?.(
        { query: "SELECT * FROM users;" },
        result,
        {} as any,
      ),
    ).toBe(false);
  });
});

describe("executeSqlTool identity column handling", () => {
  const supabaseCtx = {
    appPath: "/app",
    supabaseProjectId: "project",
    supabaseOrganizationSlug: "org",
    supabaseProviderToolsAvailable: true,
  } as any;

  const mockIdentityColumns = (rows: unknown[]) => {
    mocks.executeSupabaseSqlMock.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("pg_catalog")) {
          return JSON.stringify(rows);
        }
        return "[]";
      },
    );
  };

  it("overrides a GENERATED ALWAYS identity column and reports it", async () => {
    mockIdentityColumns([{ attname: "id", attidentity: "a" }]);

    const result = await executeSqlTool.execute(
      {
        query: "INSERT INTO users (id, name) VALUES (1, 'x');",
        description: "seed users",
      },
      supabaseCtx,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "INSERT INTO users (id, name) OVERRIDING SYSTEM VALUE VALUES (1, 'x');",
      }),
    );
    expect(result).toContain("OVERRIDING SYSTEM VALUE");
    expect(result).toContain('"id"');
    expect(result).toContain("Successfully executed SQL query.");
  });

  it("leaves a GENERATED BY DEFAULT identity column alone", async () => {
    mockIdentityColumns([{ attname: "id", attidentity: "d" }]);

    const result = await executeSqlTool.execute(
      {
        query: "INSERT INTO users (id, name) VALUES (1, 'x');",
        description: "seed users",
      },
      supabaseCtx,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "INSERT INTO users (id, name) VALUES (1, 'x');",
      }),
    );
    expect(result).not.toContain("OVERRIDING SYSTEM VALUE");
  });

  it("runs the statement unchanged when the catalog lookup fails", async () => {
    mocks.executeSupabaseSqlMock.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("pg_catalog")) {
          throw new Error("permission denied for table pg_attribute");
        }
        return "[]";
      },
    );

    const result = await executeSqlTool.execute(
      {
        query: "INSERT INTO users (id, name) VALUES (1, 'x');",
        description: "seed users",
      },
      supabaseCtx,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "INSERT INTO users (id, name) VALUES (1, 'x');",
      }),
    );
    expect(result).not.toContain("OVERRIDING SYSTEM VALUE");
  });

  it("classifies a remaining identity column error with the cause and the fix", async () => {
    mocks.executeSupabaseSqlMock.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("pg_catalog")) {
          return "[]";
        }
        throw new Error(
          'Failed to run query: Bad Request (400): ERROR: 428C9: cannot insert a non-DEFAULT value into column "id"\nDETAIL: Column "id" is an identity column defined as GENERATED ALWAYS.\nHINT: Use OVERRIDING SYSTEM VALUE to override.',
        );
      },
    );

    const error = await executeSqlTool
      .execute(
        {
          query: "INSERT INTO users (id, name) VALUES (1, 'x');",
          description: "seed users",
        },
        supabaseCtx,
      )
      .catch((thrown) => thrown);

    expect(error).toBeInstanceOf(DyadError);
    expect(error.kind).toBe(DyadErrorKind.Validation);
    expect(error.message).toContain('column "id"');
    expect(error.message).toContain("GENERATED ALWAYS");
    expect(error.message).toContain("OVERRIDING SYSTEM VALUE");
    expect(error.message).not.toContain("Bad Request (400)");
  });
});

describe("executeSqlTool.shouldTrackMutation", () => {
  const tracks = (query: string) =>
    executeSqlTool.shouldTrackMutation?.({ query }, "", {} as any);

  it("counts a mutation in any statement, not just the first", () => {
    // A miss here leaves run_tests refusing the verifying rerun with
    // "no changes since last run" after a real fix.
    expect(tracks("SELECT 1; UPDATE users SET name = 'x';")).toBe(true);
    expect(tracks("SELECT 1; INSERT INTO users (id) VALUES (1);")).toBe(true);
    expect(tracks("SELECT id FROM users; SELECT count(*) FROM orders;")).toBe(
      false,
    );
  });

  it("counts a SELECT that calls an unknown function", () => {
    expect(tracks("SELECT seed_demo_data();")).toBe(true);
    expect(tracks("SELECT count(*) FROM users WHERE (active OR admin);")).toBe(
      false,
    );
    expect(tracks("SELECT max(id), now() FROM users;")).toBe(false);
  });

  it("counts a CTE that calls an unknown function", () => {
    // The leading `with` used to skip the unknown-function check, so a
    // mutating call inside the CTE was never counted.
    expect(tracks("WITH x AS (SELECT seed_demo_data()) SELECT * FROM x;")).toBe(
      true,
    );
    expect(tracks("WITH x AS (SELECT id FROM users) SELECT * FROM x;")).toBe(
      false,
    );
  });

  it("counts a SELECT ... INTO as a schema mutation", () => {
    // `SELECT ... INTO new_table` creates a table in PostgreSQL. Missing it
    // leaves run_tests refusing the rerun after the agent seeds test data.
    expect(tracks("SELECT * INTO staging_users FROM users;")).toBe(true);
    expect(tracks("SELECT id, name INTO TEMP tmp_users FROM users;")).toBe(
      true,
    );
    // A plain read whose alias merely starts with "into" must not trip it.
    expect(tracks("SELECT count(*) AS into_total FROM users;")).toBe(false);
    // Keywords/calls inside string literals must not be mistaken for the real
    // thing: a read returning the text "into staging_users" is still read-only.
    expect(tracks("SELECT 'into staging_users';")).toBe(false);
    expect(tracks("SELECT * FROM users WHERE note = 'seed_demo_data()';")).toBe(
      false,
    );
    // A genuine SELECT ... INTO alongside a literal still counts.
    expect(tracks("SELECT 'label' AS tag INTO staging_users FROM users;")).toBe(
      true,
    );
  });

  it("still treats plain reads as no-ops", () => {
    expect(tracks("SELECT * FROM users;")).toBe(false);
    expect(tracks("SHOW search_path;")).toBe(false);
  });
});
