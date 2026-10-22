import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  canUseSupabaseTools,
  escapeXmlContent,
} from "./types";
import { getSupabaseProjectInfo } from "../../../../../../supabase_admin/supabase_context";
import { classifyManagementApiError } from "../../../../../../supabase_admin/supabase_management_client";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";

/**
 * A Management API failure must not escape as a raw SupabaseManagementAPIError:
 * a 401/403 means the organization's token was revoked (an Auth problem the
 * user fixes by reconnecting), and anything else is an upstream failure rather
 * than a product bug. Already-classified errors keep their kind.
 */
function toSupabaseProjectInfoError(error: unknown): DyadError {
  if (isDyadError(error)) {
    return error;
  }
  const classified = classifyManagementApiError(
    error,
    "read the Supabase project info",
  );
  if (isDyadError(classified)) {
    return classified;
  }
  return new DyadError(
    `Failed to get Supabase project info: ${error instanceof Error ? error.message : String(error)}`,
    DyadErrorKind.External,
    { cause: error },
  );
}

const getSupabaseProjectInfoSchema = z.object({
  includeDbFunctions: z
    .boolean()
    .optional()
    .describe(
      "When true, includes database functions in the response. Defaults to false.",
    ),
});

export const getSupabaseProjectInfoTool: ToolDefinition<
  z.infer<typeof getSupabaseProjectInfoSchema>
> = {
  name: "get_supabase_project_info",
  description:
    "Get Supabase project overview: project ID, publishable key, secret names, and table names. Use this to discover what tables exist before fetching detailed schemas. Optionally include database functions.",
  inputSchema: getSupabaseProjectInfoSchema,
  defaultConsent: "always",
  isEnabled: canUseSupabaseTools,

  getConsentPreview: () => "Get Supabase project info",

  execute: async (args, ctx: AgentContext) => {
    if (!canUseSupabaseTools(ctx)) {
      throw new DyadError(
        "Supabase is not connected to this app",
        DyadErrorKind.Precondition,
      );
    }

    ctx.onXmlStream(
      "<dyad-supabase-project-info></dyad-supabase-project-info>",
    );

    const info = await getSupabaseProjectInfo({
      supabaseProjectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
      includeDbFunctions: args.includeDbFunctions,
    }).catch((error: unknown) => {
      throw toSupabaseProjectInfoError(error);
    });

    ctx.onXmlComplete(
      `<dyad-supabase-project-info>\n${escapeXmlContent(info)}\n</dyad-supabase-project-info>`,
    );

    return info;
  },
};
