import { z } from "zod";
import type { UserSettings } from "@/lib/schemas";
import { getEnvVar } from "@/ipc/utils/read_env";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Never move a subscription request onto a separately billed API key. */
export function getDirectSearchConfig(settings: UserSettings) {
  const model = settings.selectedModel;
  if (
    settings.proModelUsage !== "api-key" ||
    !["openai", "anthropic"].includes(model.provider)
  )
    return undefined;
  const provider = model.provider;
  const apiKey = (
    settings.providerSettings?.[provider]?.apiKey?.value ||
    getEnvVar(provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY") ||
    ""
  ).trim();
  return apiKey ? { provider, apiKey, model: model.name } : undefined;
}

const openaiResponse = z.object({
  output: z.array(
    z.object({
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            annotations: z
              .array(
                z.object({
                  type: z.string(),
                  url: z.string().optional(),
                  title: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});
const anthropicResponse = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      citations: z
        .array(
          z.object({
            url: z.string().optional(),
            title: z.string().optional(),
          }),
        )
        .optional(),
      content: z.unknown().optional(),
    }),
  ),
});

export async function directWebSearch(
  query: string,
  config: NonNullable<ReturnType<typeof getDirectSearchConfig>>,
  signal?: AbortSignal,
): Promise<string> {
  const openai = config.provider === "openai";
  const response = await fetch(
    openai
      ? "https://api.openai.com/v1/responses"
      : "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      signal: AbortSignal.any([
        AbortSignal.timeout(90_000),
        ...(signal ? [signal] : []),
      ]),
      headers: openai
        ? {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          }
        : {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
          },
      body: JSON.stringify(
        openai
          ? {
              model: config.model,
              input: query,
              tools: [{ type: "web_search" }],
              tool_choice: "required",
            }
          : {
              model: config.model,
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: `Search the web for: ${query}. Cite sources.`,
                },
              ],
              tools: [
                {
                  type: "web_search_20250305",
                  name: "web_search",
                  max_uses: 3,
                },
              ],
            },
      ),
    },
  );
  if (!response.ok) {
    // Do not log response bodies: gateways can echo credentials or user content.
    throw new DyadError(
      `${config.provider} web search failed (HTTP ${response.status}). Check API access, model search support, and provider quota. No billing-source fallback was attempted.`,
      DyadErrorKind.External,
    );
  }
  const json: unknown = await response.json();
  const text: string[] = [];
  const sources = new Set<string>();
  if (openai) {
    for (const item of openaiResponse.parse(json).output) {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text) text.push(part.text);
        for (const citation of part.annotations ?? []) {
          if (citation.type === "url_citation" && citation.url)
            sources.add(citation.url);
        }
      }
    }
  } else {
    for (const part of anthropicResponse.parse(json).content) {
      if (
        part.type === "web_search_tool_result" &&
        typeof part.content === "object" &&
        part.content !== null &&
        "type" in part.content &&
        part.content.type === "web_search_tool_result_error"
      ) {
        throw new DyadError(
          "Anthropic web search returned a tool error. Check provider search access and quota.",
          DyadErrorKind.External,
        );
      }
      if (part.type === "text" && part.text) text.push(part.text);
      for (const citation of part.citations ?? []) {
        if (citation.url) sources.add(citation.url);
      }
    }
  }
  if (!text.length)
    throw new DyadError(
      "Provider web search returned no text results",
      DyadErrorKind.External,
    );
  return (
    text.join("\n\n") +
    (sources.size ? `\n\nSources:\n${[...sources].join("\n")}` : "")
  );
}
