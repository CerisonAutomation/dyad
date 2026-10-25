import type { LanguageModel } from "@/ipc/types/language-model";
import { z } from "zod";

const Row = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(300),
  context_length: z.number().int().positive().optional(),
  pricing: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  supported_parameters: z.array(z.string()).optional(),
  top_provider: z
    .object({
      max_completion_tokens: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AGE_MS = 5 * 60_000;
const MAX_PRICE_AGE_MS = 30 * 60_000;
let lastSuccessAt = 0;
let cached: LanguageModel[] | undefined;
let expiresAt = 0;
let pending: Promise<LanguageModel[] | undefined> | undefined;
function snapshot(): LanguageModel[] | undefined {
  if (!cached) return undefined;
  // Retain discoverable model identities during outages, not an indefinitely
  // trusted claim about zero pricing that can influence automatic routing.
  return structuredClone(
    Date.now() - lastSuccessAt <= MAX_PRICE_AGE_MS
      ? cached
      : cached.map((model) => ({
          ...model,
          isFree: false,
          dollarSigns: undefined,
          tag: undefined,
          description:
            "Pricing metadata expired. Verify provider pricing before use.",
        })),
  );
}

export function parseOpenRouterModels(value: unknown): LanguageModel[] {
  const envelope = z
    .object({ data: z.array(z.unknown()).max(5000) })
    .parse(value);
  const seen = new Map<string, LanguageModel>();
  return envelope.data.flatMap((value) => {
    const row = Row.safeParse(value);
    if (!row.success) return [];
    const model = row.data;

    const price = (value: string | number | undefined) =>
      value === undefined || (typeof value === "string" && !value.trim())
        ? NaN
        : typeof value === "number" ||
            /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
          ? Number(value)
          : NaN;
    // Every advertised price must be zero, not just input/output tokens.
    const isFree =
      !!model.pricing &&
      model.pricing.prompt !== undefined &&
      model.pricing.completion !== undefined &&
      Object.values(model.pricing).every(
        (value) => Number.isFinite(price(value)) && price(value) === 0,
      );
    const result: LanguageModel = {
      apiName: model.id,
      displayName: model.name,
      type: "cloud" as const,
      contextWindow: model.context_length,
      maxOutputTokens: model.top_provider?.max_completion_tokens ?? undefined,
      isFree,
      supportsTools: model.supported_parameters?.includes("tools"),
      ...(isFree
        ? {
            dollarSigns: 0,
            tag: "Free",
            description:
              "Provider-listed zero pricing; availability, quotas and data policies still apply.",
          }
        : {}),
    };
    const previous = seen.get(model.id);
    if (previous) {
      // Duplicate IDs with inconsistent prices/capabilities are not allowed to
      // make a paid or non-tool model eligible for automatic free routing.
      if (!result.isFree) {
        previous.isFree = false;
        previous.dollarSigns = undefined;
        previous.tag = undefined;
        previous.description =
          "Conflicting provider metadata. Verify model pricing.";
      }
      if (result.supportsTools !== true)
        previous.supportsTools = result.supportsTools;
      if (result.contextWindow !== undefined)
        previous.contextWindow = Math.min(
          previous.contextWindow ?? result.contextWindow,
          result.contextWindow,
        );
      return [];
    }
    seen.set(model.id, result);
    return [result];
  });
}

/** Public metadata only: no API keys, inference requests, redirects or cloud gateway. */
export async function discoverOpenRouterModels(): Promise<
  LanguageModel[] | undefined
> {
  if (Date.now() < expiresAt) return snapshot();
  if (pending) return cached ? snapshot() : pending.then(() => snapshot());
  pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok || !response.body)
        throw new Error("Model discovery unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES)
            throw new Error("Model discovery response too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const models = parseOpenRouterModels(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!models.length) throw new Error("Empty model discovery");
      cached = models;
      lastSuccessAt = Date.now();
      expiresAt = Date.now() + MAX_AGE_MS;
      return cached;
    } catch {
      // Also close a non-OK response body/socket rather than leaving an unread
      // body alive until garbage collection.
      controller.abort();
      // Back off, retain last-known-good metadata, or let callers use builtins.
      expiresAt = Date.now() + 30_000;
      return cached;
    } finally {
      clearTimeout(timer);
      pending = undefined;
    }
  })();
  // Warm refreshes must not stall model switching behind a network request.
  return cached ? snapshot() : pending.then(() => snapshot());
}
