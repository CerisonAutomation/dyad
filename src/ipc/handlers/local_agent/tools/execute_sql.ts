import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  canUseLinkedDatabaseTools,
  canUseNeonTools,
  canUseSupabaseTools,
  escapeXmlAttr,
  escapeXmlContent,
  getUnavailableDatabaseProviderMessage,
} from "./types";
import { executeSupabaseSql } from "../../../../supabase_admin/supabase_management_client";
import { executeNeonSql } from "../../../../neon_admin/neon_context";
import { writeMigrationFile } from "../../../utils/file_utils";
import { readSettings } from "../../../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveLinkedDatabaseProvider } from "@/shared/database_provider";
import {
  doesSqlDeleteData,
  doesSqlMutateSchema,
} from "@/lib/sqlSchemaMutation";
import {
  boundToolOutput,
  MAX_SQL_QUERY_CHARS,
  MAX_SQL_RESULT_CHARS,
} from "./tool_output_limits";
import {
  applyIdentityOverride,
  buildIdentityColumnQuery,
  describeIdentityColumnError,
  isIdentityColumnError,
  parseIdentityColumns,
  parseInsertForIdentityCheck,
  type IdentityColumn,
} from "./execute_sql_identity";

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

/**
 * Blank out string literals so tokens *inside* them aren't misread as SQL
 * keywords or function calls by the read-only classifier. Without this a plain
 * read like `SELECT 'into staging_users'` matches the `into` mutation check and
 * is wrongly recorded as a mutation, letting run_tests rerun with no app change.
 * Dollar-quoted strings are stripped before single-quoted ones because their
 * body can itself contain single quotes.
 */
function stripSqlStringLiterals(statement: string): string {
  return statement
    .replace(/\$([a-z_]\w*)?\$[\s\S]*?\$\1\$/gi, " ")
    .replace(/'(?:[^']|'')*'/g, " ");
}

/**
 * Identifiers that may precede a `(` in a read-only `select` without implying a
 * function call that could mutate: SQL keywords (`where (a or b)`, `in (...)`)
 * plus well-known read-only builtins. Anything else — e.g. `SELECT seed()` —
 * may be a user-defined function that writes.
 */
const SELECT_SAFE_IDENTIFIERS = new Set([
  // Keywords that are followed by a parenthesized expression, not a call.
  "all",
  "and",
  "any",
  "as",
  "by",
  "case",
  "exists",
  "from",
  "group",
  "having",
  "in",
  "join",
  "not",
  "on",
  "or",
  "order",
  "over",
  "partition",
  "select",
  "then",
  "union",
  "using",
  "values",
  "when",
  "where",
  // Read-only builtins.
  "abs",
  "avg",
  "cast",
  "ceil",
  "coalesce",
  "concat",
  "count",
  "current_date",
  "current_setting",
  "current_timestamp",
  "date_trunc",
  "extract",
  "floor",
  "greatest",
  "json_agg",
  "jsonb_agg",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "now",
  "nullif",
  "round",
  "sum",
  "to_char",
  "trim",
  "upper",
  "version",
]);

/**
 * True when a `select` calls anything other than a known read-only builtin.
 * `SELECT seed_demo_data()` really does mutate, and treating it as a no-op
 * would leave run_tests refusing the verifying rerun.
 */
function doesSelectCallUnknownFunction(statement: string): boolean {
  for (const [, name] of statement.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (!SELECT_SAFE_IDENTIFIERS.has(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function doesStatementLikelyMutateState(statement: string): boolean {
  // Classify against a copy with string literals blanked out so keywords and
  // function calls appearing inside literals don't skew the result.
  const scannable = stripSqlStringLiterals(statement);
  if (/^with\b/i.test(scannable)) {
    // A CTE can hide a mutating call (`WITH x AS (SELECT seed_demo_data())
    // SELECT * FROM x`), so the unknown-function check applies here too.
    return (
      /\b(insert|update|delete|merge)\b/i.test(scannable) ||
      doesSelectCallUnknownFunction(scannable)
    );
  }
  const explained = scannable.match(/^explain(?:\s+analyze)?\s+(.+)$/i);
  if (explained) {
    return doesStatementLikelyMutateState(explained[1].trim());
  }
  // Treat clearly read-only statements as no-ops for run_tests gating. Unknown
  // SQL is counted conservatively because function calls and procedural blocks
  // can mutate data even when static analysis cannot prove it.
  if (!/^(?:select|show|describe|desc)\b/i.test(scannable)) {
    return true;
  }
  if (!/^select\b/i.test(scannable)) {
    // show / describe / desc are read-only.
    return false;
  }
  // `SELECT ... INTO new_table` creates a table in PostgreSQL (a schema
  // mutation) even though the statement still begins with SELECT, so the
  // read-only classification below would otherwise miss it and leave run_tests
  // refusing the verifying rerun. `(?!@)` skips `SELECT ... INTO @var` variable
  // assignment, which doesn't create a table.
  if (/\binto\s+(?!@)/i.test(scannable)) {
    return true;
  }
  return doesSelectCallUnknownFunction(scannable);
}

/**
 * Inspect EVERY statement, not just the first: `SELECT 1; UPDATE users ...`
 * mutates, and classifying the whole call by its leading `SELECT` would leave
 * run_tests refusing the next run with "no changes since last run".
 */
function doesSqlLikelyMutateState(sql: string): boolean {
  if (doesSqlMutateSchema(sql) || doesSqlDeleteData(sql)) {
    return true;
  }
  return stripSqlComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .some(doesStatementLikelyMutateState);
}

const executeSqlSchema = z.object({
  query: z
    .string()
    .max(MAX_SQL_QUERY_CHARS)
    .describe("The SQL query to execute"),
  description: z.string().optional().describe("Brief description of the query"),
});

type SqlRunner = (query: string) => Promise<string>;

interface PreparedSql {
  /** The SQL that should actually be executed. */
  sql: string;
  /** Model-facing note describing the `OVERRIDING SYSTEM VALUE` rewrite. */
  notice?: string;
}

/**
 * Look up the identity columns of an insert target and, when the statement
 * supplies a value for a `GENERATED ALWAYS` identity column, inject
 * `OVERRIDING SYSTEM VALUE` (PostgreSQL rejects the explicit value otherwise,
 * SQLSTATE 428C9).
 *
 * The catalog lookup is best effort: when it cannot run, the statement is
 * executed unchanged so the check can never break a valid statement.
 */
async function prepareIdentitySafeSql(
  query: string,
  runSql: SqlRunner,
): Promise<PreparedSql> {
  const parsed = parseInsertForIdentityCheck(query);
  if (!parsed) {
    return { sql: query };
  }
  const metadataQuery = buildIdentityColumnQuery(parsed);
  if (!metadataQuery) {
    return { sql: query };
  }
  let identityColumns: IdentityColumn[];
  try {
    identityColumns = parseIdentityColumns(await runSql(metadataQuery));
  } catch {
    return { sql: query };
  }
  const rewrite = applyIdentityOverride(query, parsed, identityColumns);
  if (!rewrite) {
    return { sql: query };
  }
  const columns = rewrite.overriddenColumns
    .map((name) => `"${name}"`)
    .join(", ");
  const table = parsed.schema
    ? `${parsed.schema}.${parsed.table}`
    : parsed.table;
  return {
    sql: rewrite.sql,
    notice:
      `Note: ${columns} in table ${table} is an identity column defined as ` +
      `GENERATED ALWAYS, so PostgreSQL rejects an explicit value for it by ` +
      `default. The statement was executed with OVERRIDING SYSTEM VALUE, so ` +
      `the value you passed for ${columns} was accepted (a DEFAULT for ` +
      `${columns} still comes from the sequence). Omit ${columns} from the ` +
      `INSERT column list if the sequence should assign it.`,
  };
}

/**
 * Run the statement, turning an identity-column rejection into a typed error
 * that names the cause and the fix instead of a raw provider blob.
 */
async function executeSqlWithIdentityClassification(
  sql: string,
  runSql: SqlRunner,
): Promise<string> {
  try {
    return await runSql(sql);
  } catch (error) {
    if (isIdentityColumnError(error)) {
      // Deliberate re-classification: the provider reports this as an
      // opaque external failure, but the cause and the fix are known.
      throw new DyadError(
        describeIdentityColumnError(error),
        DyadErrorKind.Validation,
        { cause: error },
      );
    }
    throw error;
  }
}

function formatSqlResult({
  migrationFileWritten,
  notice,
  sqlResult,
}: {
  migrationFileWritten: boolean;
  notice?: string;
  sqlResult: string;
}): string {
  // The leading sentence is asserted by `shouldTrackFileMutation`, so the
  // override note goes after it.
  const header = migrationFileWritten
    ? "Successfully executed SQL query and wrote a migration file."
    : "Successfully executed SQL query.";
  const noticeBlock = notice ? `\n\n${notice}` : "";
  return `${header}${noticeBlock}\n\nSQL result:\n${sqlResult}`;
}

export const executeSqlTool: ToolDefinition<z.infer<typeof executeSqlSchema>> =
  {
    name: "execute_sql",
    description:
      "Execute SQL on the connected database. Important: execute each SQL command separately (do not group multiple commands in a single query).",
    inputSchema: executeSqlSchema,
    defaultConsent: "ask",
    modifiesState: true,
    isEnabled: canUseLinkedDatabaseTools,

    getConsentPreview: (args) => args.query,

    getConsentMetadata: (args) => ({
      sqlMutatesSchema: doesSqlMutateSchema(args.query),
      sqlDeletesData: doesSqlDeleteData(args.query),
    }),

    shouldTrackMutation: (args) => doesSqlLikelyMutateState(args.query),
    shouldTrackFileMutation: (_args, result) =>
      result.startsWith(
        "Successfully executed SQL query and wrote a migration file.",
      ),

    buildXml: (args, isComplete) => {
      if (args.query == undefined) return undefined;

      let xml = `<dyad-execute-sql description="${escapeXmlAttr(args.description ?? "")}">\n${escapeXmlContent(args.query)}`;
      if (isComplete) {
        xml += "\n</dyad-execute-sql>";
      }
      return xml;
    },

    execute: async (args, ctx: AgentContext) => {
      const provider = resolveLinkedDatabaseProvider({
        hasSupabaseProject: Boolean(ctx.supabaseProjectId),
        hasNeonProject: Boolean(ctx.neonProjectId),
      });

      if (provider === "supabase" && canUseSupabaseTools(ctx)) {
        const runSql: SqlRunner = (query) =>
          executeSupabaseSql({
            supabaseProjectId: ctx.supabaseProjectId,
            query,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
            // Forward the turn signal so a cancelled turn does not leave the
            // statement (and its retry loop) running.
            signal: ctx.abortSignal,
          });

        const { sql, notice } = await prepareIdentitySafeSql(
          args.query,
          runSql,
        );

        const sqlResult = boundToolOutput(
          await executeSqlWithIdentityClassification(sql, runSql),
          MAX_SQL_RESULT_CHARS,
        );

        const settings = readSettings();
        let migrationFileWritten = false;
        if (
          settings.enableSupabaseWriteSqlMigration &&
          doesSqlMutateSchema(args.query)
        ) {
          try {
            // Record the statement that actually ran.
            await writeMigrationFile(ctx.appPath, sql, args.description);
            migrationFileWritten = true;
          } catch (error) {
            return `SQL executed, but failed to write migration file: ${error}\n\nSQL result:\n${sqlResult}`;
          }
        }

        return formatSqlResult({
          migrationFileWritten,
          notice,
          sqlResult,
        });
      }

      if (provider === "neon" && canUseNeonTools(ctx)) {
        const runSql: SqlRunner = (query) =>
          executeNeonSql({
            projectId: ctx.neonProjectId,
            branchId: ctx.neonActiveBranchId,
            query,
          });

        const { sql, notice } = await prepareIdentitySafeSql(
          args.query,
          runSql,
        );

        const sqlResult = boundToolOutput(
          await executeSqlWithIdentityClassification(sql, runSql),
          MAX_SQL_RESULT_CHARS,
        );
        return formatSqlResult({
          migrationFileWritten: false,
          notice,
          sqlResult,
        });
      }

      throw new DyadError(
        getUnavailableDatabaseProviderMessage(ctx, "SQL execution"),
        DyadErrorKind.Precondition,
      );
    },
  };
