import uiRegistries from "@/prompts/guides/ui-registries.md?raw";
import { z } from "zod";
import { ToolDefinition, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

import addAuthentication from "@/prompts/guides/add-authentication.md?raw";
import addEmailVerification from "@/prompts/guides/add-email-verification.md?raw";
import addPasswordReset from "@/prompts/guides/add-password-reset.md?raw";
import customSupabaseTestFixtures from "@/prompts/guides/custom-supabase-test-fixtures.md?raw";
import frameworkRust from "@/prompts/guides/framework-rust.md?raw";
import frameworkSvelte from "@/prompts/guides/framework-svelte.md?raw";
import frameworkFlutter from "@/prompts/guides/framework-flutter.md?raw";
import frameworkTauri from "@/prompts/guides/framework-tauri.md?raw";
import frameworkSelection from "@/prompts/guides/framework-selection.md?raw";
import context7Reference from "@/prompts/guides/context7-reference.md?raw";
import { renderGuide } from "@/prompts/guides/render_guide";
import { readSettings } from "@/main/settings";

/**
 * Registry of available guides. To add a new guide, import its .md file
 * with ?raw and add an entry here.
 */
const GUIDES: Record<string, { content: string; frameworkSpecific?: boolean }> =
  {
    "add-authentication": {
      content: addAuthentication,
      frameworkSpecific: true,
    },
    "add-email-verification": {
      content: addEmailVerification,
      frameworkSpecific: true,
    },
    "add-password-reset": {
      content: addPasswordReset,
      frameworkSpecific: true,
    },
    "custom-supabase-test-fixtures": { content: customSupabaseTestFixtures },
    "framework-rust": { content: frameworkRust },
    "framework-svelte": { content: frameworkSvelte },
    "framework-flutter": { content: frameworkFlutter },
    "framework-tauri": { content: frameworkTauri },
    "framework-selection": { content: frameworkSelection },
    "context7-reference": { content: context7Reference },
    "ui-registries": { content: uiRegistries },
  };

const readGuideSchema = z.object({
  guide: z
    .string()
    .describe(
      "Name of the guide to read (e.g. 'add-authentication', 'add-email-verification', 'add-password-reset', 'framework-rust', 'framework-svelte', 'framework-flutter', 'framework-tauri', 'framework-selection', 'context7-reference', 'ui-registries')",
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
    const guide = Object.hasOwn(GUIDES, args.guide)
      ? GUIDES[args.guide]
      : undefined;
    if (!guide) {
      const available = Object.keys(GUIDES).join(", ");
      throw new DyadError(
        `Guide "${args.guide}" not found. Available guides: ${available}`,
        DyadErrorKind.NotFound,
      );
    }
    // Only auth guides contain framework-specific rendering blocks.
    if (!guide.frameworkSpecific) return guide.content;
    return renderGuide(guide.content, ctx.frameworkType, {
      enableAppPreviewDomains: readSettings().enableAppPreviewDomains,
    });
  },
};
