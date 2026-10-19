import { z } from "zod";
import { ToolDefinition, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

import addAuthentication from "@/prompts/guides/add-authentication.md?raw";
import addEmailVerification from "@/prompts/guides/add-email-verification.md?raw";
import addPasswordReset from "@/prompts/guides/add-password-reset.md?raw";
import replicaArchitect from "@/prompts/guides/replica-architect.md?raw";
import replicaBackend from "@/prompts/guides/replica-backend.md?raw";
import replicaBrand from "@/prompts/guides/replica-brand.md?raw";
import replicaBuild from "@/prompts/guides/replica-build.md?raw";
import replicaDeploy from "@/prompts/guides/replica-deploy.md?raw";
import replicaDesign from "@/prompts/guides/replica-design.md?raw";
import replicaDiff from "@/prompts/guides/replica-diff.md?raw";
import replicaEntrepreneur from "@/prompts/guides/replica-entrepreneur.md?raw";
import replicaLaunch from "@/prompts/guides/replica-launch.md?raw";
import replicaRecon from "@/prompts/guides/replica-recon.md?raw";
import replicaTest from "@/prompts/guides/replica-test.md?raw";
import { filterGuideByFramework } from "@/prompts/guides/filter_guide_by_framework";

/**
 * Registry of available guides. To add a new guide, import its .md file
 * with ?raw and add an entry here.
 */
const GUIDES: Record<string, string> = {
  "add-authentication": addAuthentication,
  "add-email-verification": addEmailVerification,
  "add-password-reset": addPasswordReset,
  "replica-recon": replicaRecon,
  "replica-architect": replicaArchitect,
  "replica-design": replicaDesign,
  "replica-build": replicaBuild,
  "replica-backend": replicaBackend,
  "replica-test": replicaTest,
  "replica-diff": replicaDiff,
  "replica-entrepreneur": replicaEntrepreneur,
  "replica-brand": replicaBrand,
  "replica-launch": replicaLaunch,
  "replica-deploy": replicaDeploy,
};

const readGuideSchema = z.object({
  guide: z
    .string()
    .describe(
      "Name of the guide to read (e.g. 'add-authentication', 'replica-recon', 'replica-build')",
    ),
});

export const readGuideTool: ToolDefinition<z.infer<typeof readGuideSchema>> = {
  name: "read_guide",
  description:
    "Read a detailed instruction guide. Use this when the system prompt tells you to load a guide before implementing a feature.",
  inputSchema: readGuideSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Read guide: ${args.guide}`,

  buildXml: (args) => {
    if (!args.guide) return undefined;
    return `<dyad-read-guide name="${escapeXmlAttr(args.guide)}"></dyad-read-guide>`;
  },

  execute: async (args, ctx) => {
    const content = GUIDES[args.guide];
    if (!content) {
      const available = Object.keys(GUIDES).join(", ");
      throw new DyadError(
        `Guide "${args.guide}" not found. Available guides: ${available}`,
        DyadErrorKind.NotFound,
      );
    }
    return filterGuideByFramework(content, ctx.frameworkType);
  },
};
