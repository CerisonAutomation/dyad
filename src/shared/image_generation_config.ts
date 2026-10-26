import { z } from "zod";

export function imageApiBase(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new Error(
      "Use HTTPS, or HTTP on an explicitly configured loopback image server, without URL credentials/query/fragment",
    );
  return url;
}
export const ImageGenerationSettingsSchema = z
  .object({
    backend: z.enum([
      "disabled",
      "cloudflare",
      "chatgpt-subscription",
      "openai-compatible",
    ]),
    model: z.string().trim().max(200).default(""),
    providerId: z.string().trim().max(128).default(""),
    accountId: z.string().trim().max(64).optional(),
    baseUrl: z.string().trim().max(2048).optional(),
    allowPaidRemote: z.boolean().default(false),
    requestFormat: z.enum(["json", "multipart"]).optional(),
    width: z.number().int().min(256).max(1920).optional(),
    height: z.number().int().min(256).max(1920).optional(),
  })
  .superRefine((config, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (config.backend === "disabled") return;
    if (!config.model) error("Choose an image model");
    if (config.backend === "chatgpt-subscription") return;
    if (!config.providerId) error("Choose a credential slot");
    if (config.backend === "cloudflare") {
      if (!/^[a-f\d]{32}$/i.test(config.accountId ?? ""))
        error("Enter the 32-character Cloudflare account ID");
      if (!/^@(cf|hf)\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(config.model))
        error(
          "Enter a Cloudflare image model ID, for example @cf/black-forest-labs/flux-1-schnell",
        );
    } else {
      try {
        const url = imageApiBase(config.baseUrl ?? "");
        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (
          host === "openai.com" ||
          host.endsWith(".openai.com") ||
          /(?:^|[/:])gpt[-_.]?image/i.test(config.model)
        )
          error(
            "GPT images must use ChatGPT subscription (OAuth), not an API key or OpenAI API endpoint",
          );
        if (
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
          !config.allowPaidRemote
        )
          error(
            "Explicitly authorize remote image API billing before using this endpoint",
          );
      } catch (e) {
        error(e instanceof Error ? e.message : "Invalid image endpoint");
      }
    }
  });
export type ImageGenerationSettings = z.infer<
  typeof ImageGenerationSettingsSchema
>;

/** Renderer-safe readiness check; does not contact a provider or verify quota. */
export function isImageGenerationReady(
  settings:
    | {
        imageGeneration?: unknown;
        providerSettings?: Record<string, { apiKey?: { value?: string } }>;
      }
    | null
    | undefined,
): boolean {
  const parsed = ImageGenerationSettingsSchema.safeParse(
    settings?.imageGeneration,
  );
  if (!parsed.success || parsed.data.backend === "disabled") return false;
  const config = parsed.data;
  if (config.backend === "chatgpt-subscription") return true;
  const local =
    config.backend === "openai-compatible" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      imageApiBase(config.baseUrl!).hostname,
    );
  return (
    local ||
    !!settings?.providerSettings?.[config.providerId]?.apiKey?.value?.trim()
  );
}
