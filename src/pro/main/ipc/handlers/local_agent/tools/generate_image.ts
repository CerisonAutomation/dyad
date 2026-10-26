import { z } from "zod";
import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { readSettings } from "@/main/settings";
import {
  generateProviderImage,
  isProviderImageGenerationConfigured,
} from "@/ipc/utils/provider_image_generation";
import {
  DYAD_MEDIA_DIR_NAME,
  prepareGeneratedImageDirectory,
} from "@/ipc/utils/media_path_utils";

const logger = log.scope("generate_image");

const generateImageSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .describe(
      "A detailed, descriptive prompt for the image to generate. Be specific about colors, composition, style, mood, and subject matter. Avoid generic or vague descriptions.",
    ),
});

const DESCRIPTION = `Generate an image using AI based on a text prompt. The generated image is saved to the project's .dyad/media directory.

### When to Use
- User requests a custom image, illustration, icon, or graphic for their app
- User wants a hero image, background, banner, or visual asset
- Creating images that are more visually relevant than placeholder rectangles

### Prompt Guidelines
Write detailed, descriptive prompts. Be specific about:
- **Subject**: What is in the image (objects, people, scenes)
- **Style**: Photography, illustration, flat design, 3D render, watercolor, etc.
- **Composition**: Layout, perspective, framing
- **Colors**: Specific color palette or mood
- **Mood**: Cheerful, professional, dramatic, minimal, etc.

### Examples
- "A modern flat illustration of a team collaborating around a laptop, using a blue and purple color palette, clean minimal style with subtle gradients, white background"
- "Professional product photography of a sleek smartphone on a marble surface, soft studio lighting, shallow depth of field, warm neutral tones"

### After Generation
The tool returns the file path in .dyad/media. Use the copy_file tool to copy it to the appropriate location in the project (e.g., public/assets/) and reference that path in your code.
`;

async function saveGeneratedImage(
  image: { bytes: Buffer; extension: string },
  appPath: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const mediaDir = await prepareGeneratedImageDirectory(appPath, () =>
    signal?.throwIfAborted(),
  );
  const fileName = `generated-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${image.extension}`;
  const filePath = path.join(mediaDir, fileName);
  const temporaryPath = `${filePath}.tmp`;
  let published = false;
  try {
    await fs.writeFile(temporaryPath, image.bytes, { signal, flag: "wx" });
    signal?.throwIfAborted();
    await fs.rename(temporaryPath, filePath);
    published = true;
    signal?.throwIfAborted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      await fs.rm(temporaryPath, { force: true });
    if (published) await fs.rm(filePath, { force: true });
    throw error;
  }
  return path.join(DYAD_MEDIA_DIR_NAME, fileName);
}

export const generateImageTool: ToolDefinition<
  z.infer<typeof generateImageSchema>
> = {
  name: "generate_image",
  description: DESCRIPTION,
  inputSchema: generateImageSchema,
  defaultConsent: "ask",
  modifiesState: true,
  usesEngineEndpoint: false,

  isEnabled: (ctx) =>
    isProviderImageGenerationConfigured(
      ctx.inferenceSettings ?? readSettings(),
    ),

  getConsentPreview: (args) =>
    `Generate image with your configured image provider (account pricing/quotas apply; no fallback): "${args.prompt}"`,

  shouldTrackMutation: (_args, result) =>
    result.startsWith("Image generated and saved"),

  buildXml: (args, isComplete) => {
    if (!args.prompt) return undefined;
    if (isComplete) return undefined;
    return `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}">`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(
      "Generating image with the explicitly configured image provider",
    );

    ctx.onXmlStream(
      `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}">`,
    );

    try {
      const imageData = await generateProviderImage(
        ctx.inferenceSettings ?? readSettings(),
        args.prompt,
        ctx.abortSignal,
      );

      const relativePath = await saveGeneratedImage(
        imageData,
        ctx.appPath,
        ctx.abortSignal,
      );

      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}" path="${escapeXmlAttr(relativePath)}">${escapeXmlContent(relativePath)}</dyad-image-generation>`,
      );

      logger.log(`Image generation completed, saved to: ${relativePath}`);

      return `Image generated and saved to: ${relativePath}\nUse the copy_file tool to copy it from "${relativePath}" to the appropriate location in the project (e.g., public/assets/), then reference the copied path in your code.`;
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}"></dyad-image-generation>`,
      );
      throw error;
    }
  },
};
