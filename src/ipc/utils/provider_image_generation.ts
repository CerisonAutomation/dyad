import { imageSize } from "image-size";
import type { UserSettings } from "@/lib/schemas";
import {
  ImageGenerationSettingsSchema,
  imageApiBase,
} from "@/shared/image_generation_config";
import { isDyadCloudUrl } from "@/main/dyad_cloud_policy";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";

export const MAX_GENERATED_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
function configuration(settings: UserSettings) {
  const parsed = ImageGenerationSettingsSchema.safeParse(
    settings.imageGeneration,
  );
  if (!parsed.success || parsed.data.backend === "disabled")
    throw new DyadError(
      "Configure an image backend in Settings → Image generation. No paid or legacy fallback was attempted.",
      DyadErrorKind.Precondition,
    );
  const config = parsed.data;
  if (config.backend === "chatgpt-subscription")
    return {
      config,
      apiKey: undefined,
      endpoint: new URL("https://chatgpt.com/backend-api/codex/responses"),
    };
  const apiKey =
    settings.providerSettings?.[config.providerId]?.apiKey?.value?.trim();
  const endpoint =
    config.backend === "cloudflare"
      ? new URL(
          `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`,
        )
      : new URL(
          `${imageApiBase(config.baseUrl!).href.replace(/\/$/, "")}/images/generations`,
        );
  if (isDyadCloudUrl(endpoint.href))
    throw new DyadError(
      "Choose a direct image provider, not a legacy hosted endpoint",
      DyadErrorKind.Precondition,
    );
  if (
    (config.backend === "cloudflare" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) &&
    !apiKey
  )
    throw new DyadError(
      "Save an API token in the configured image credential slot",
      DyadErrorKind.Auth,
    );
  return { config, apiKey, endpoint };
}
export function isProviderImageGenerationConfigured(
  settings: UserSettings,
): boolean {
  try {
    configuration(settings);
    return true;
  } catch {
    return false;
  }
}
async function boundedBody(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > maximum) {
    await response.body?.cancel();
    throw new DyadError(
      "Image response exceeds maximum allowed size",
      DyadErrorKind.Validation,
    );
  }
  if (!response.body)
    throw new DyadError("Empty image response", DyadErrorKind.External);
  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > maximum)
        throw new DyadError(
          "Image response exceeds maximum allowed size",
          DyadErrorKind.Validation,
        );
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function httpFailure(status: number): never {
  throw new DyadError(
    `Image generation failed (HTTP ${status}). No provider fallback was attempted.`,
    status === 401 || status === 403
      ? DyadErrorKind.Auth
      : status === 429
        ? DyadErrorKind.RateLimited
        : DyadErrorKind.External,
  );
}
export function validateGeneratedImage(bytes: Buffer): {
  bytes: Buffer;
  extension: "png" | "jpg" | "webp";
} {
  if (!bytes.length || bytes.length > MAX_GENERATED_IMAGE_BYTES)
    throw new DyadError(
      "Image exceeds maximum allowed size or is empty",
      DyadErrorKind.Validation,
    );
  try {
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP";
    if (!png && !jpeg && !webp) throw new Error("Unsupported image signature");
    const dimensions = imageSize(bytes);
    const type = dimensions.type === "jpeg" ? "jpg" : dimensions.type;
    if (
      !["png", "jpg", "webp"].includes(type ?? "") ||
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width * dimensions.height > 25_000_000
    )
      throw new Error("Unsupported format or dimensions");
    return { bytes, extension: type as "png" | "jpg" | "webp" };
  } catch {
    throw new DyadError(
      "Provider returned invalid/unsupported raster image data or excessive dimensions",
      DyadErrorKind.Validation,
    );
  }
}
/** Main-only, explicit image configuration. Never inherits chat billing or silently retries. */
export async function generateProviderImage(
  settings: UserSettings,
  prompt: string,
  callerSignal?: AbortSignal,
) {
  callerSignal?.throwIfAborted();
  const { config, apiKey, endpoint } = configuration(settings);
  if (
    !prompt.trim() ||
    prompt.length > (config.backend === "cloudflare" ? 2048 : 12000)
  )
    throw new DyadError(
      "Image prompt is empty or exceeds the backend's supported length",
      DyadErrorKind.Validation,
    );
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = AbortSignal.any([
    timeout,
    ...(callerSignal ? [callerSignal] : []),
  ]);
  try {
    if (config.backend === "chatgpt-subscription") {
      // Only the existing OAuth credential store is used. NEVER read provider
      // API keys, OPENAI_API_KEY, or a configurable endpoint for this source.
      const { getCodexSubscriptionCredentials } =
        await import("../services/codex_subscription_auth");
      const { getCodexClientVersion } =
        await import("../shared/remote_language_model_catalog");
      const credentials = await getCodexSubscriptionCredentials();
      signal.throwIfAborted();
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${credentials.access}`,
          "ChatGPT-Account-Id": credentials.accountId,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "OpenAI-Beta": "responses=experimental",
          version: getCodexClientVersion(),
        },
        body: JSON.stringify({
          model: config.model,
          store: false,
          stream: true,
          instructions:
            "Generate one image using the image_generation tool. Return the image, not commentary.",
          input: [
            { role: "user", content: [{ type: "input_text", text: prompt }] },
          ],
          tools: [{ type: "image_generation", output_format: "png" }],
          tool_choice: "required",
          parallel_tool_calls: false,
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        httpFailure(response.status);
      }
      const base64 = await readSubscriptionImage(response, signal);
      return validateGeneratedImage(decodeImageBase64(base64));
    }
    const multipart =
      config.backend === "cloudflare" && config.requestFormat === "multipart";
    let body: string | FormData;
    if (multipart) {
      const form = new FormData();
      form.set("prompt", prompt);
      form.set("width", String(config.width ?? 1024));
      form.set("height", String(config.height ?? 1024));
      body = form;
    } else
      body = JSON.stringify(
        config.backend === "cloudflare"
          ? { prompt }
          : { prompt, model: config.model, n: 1 },
      );
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        ...(!multipart ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      // FormData supplies its own boundary. GPT image requests must omit the
      // unsupported legacy response_format. Never substitute another model.
      body,
    });
    if (!response.ok) {
      await response.body?.cancel();
      httpFailure(response.status);
    }
    const binary =
      config.backend === "cloudflare" &&
      response.headers.get("content-type")?.startsWith("image/");
    const responseBytes = await boundedBody(
      response,
      binary ? MAX_GENERATED_IMAGE_BYTES : MAX_JSON_BYTES,
      signal,
    );
    if (binary) return validateGeneratedImage(responseBytes);
    const raw: unknown = JSON.parse(responseBytes.toString("utf8"));
    const data = raw as {
      success?: boolean;
      result?: { image?: unknown };
      image?: unknown;
      data?: { b64_json?: unknown; url?: unknown }[];
    };
    if (config.backend === "cloudflare" && data.success === false)
      throw new DyadError(
        "Image provider rejected the request. Check quota, model and token permissions; no fallback was attempted.",
        DyadErrorKind.External,
      );
    const first =
      config.backend === "cloudflare"
        ? { b64_json: data.result?.image ?? data.image }
        : data.data?.[0];
    let bytes: Buffer;
    if (typeof first?.b64_json === "string") {
      bytes = decodeImageBase64(first.b64_json);
    } else if (typeof first?.url === "string") {
      const download = new URL(first.url);
      // No arbitrary response-supplied URLs, private-network pivots, credentials
      // or redirects. Prefer base64 for providers using separate CDN origins.
      if (
        download.origin !== endpoint.origin ||
        download.username ||
        download.password ||
        download.hash
      )
        throw new DyadError(
          "Image download must use the configured provider origin; request base64 output for external CDN responses",
          DyadErrorKind.Validation,
        );
      const imageResponse = await fetch(download, {
        signal,
        redirect: "error",
      });
      if (!imageResponse.ok) {
        await imageResponse.body?.cancel();
        httpFailure(imageResponse.status);
      }
      bytes = await boundedBody(
        imageResponse,
        MAX_GENERATED_IMAGE_BYTES,
        signal,
      );
    } else
      throw new DyadError(
        "No image data returned from the configured provider",
        DyadErrorKind.External,
      );
    signal.throwIfAborted();
    return validateGeneratedImage(bytes);
  } catch (error) {
    if (callerSignal?.aborted)
      throw new DyadError(
        "Image generation cancelled.",
        DyadErrorKind.UserCancelled,
      );
    if (timeout.aborted)
      throw new DyadError(
        "Image generation timed out. Please try again.",
        DyadErrorKind.External,
      );
    if (isDyadError(error)) throw error;
    // Never echo provider response bodies, request headers, prompts or tokens.
    throw new DyadError(
      "Failed to read a valid image from the configured provider.",
      DyadErrorKind.External,
    );
  }
}

function decodeImageBase64(value: string): Buffer {
  if (
    value.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 ||
    !(value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value))
  )
    throw new DyadError(
      "Invalid or oversized base64 image response",
      DyadErrorKind.Validation,
    );
  return Buffer.from(value, "base64");
}
/** Bounded SSE parser: require terminal completion, ignore partial previews and
 * never execute model text or follow image URLs. No automatic paid retry. */
async function readSubscriptionImage(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new DyadError("Empty ChatGPT image stream", DyadErrorKind.External);
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let buffer = "",
    total = 0,
    eventSize = 0,
    image: string | undefined,
    completed = false;
  let lines: string[] = [];
  const decoder = new TextDecoder();
  const remember = (
    item:
      | { type?: unknown; result?: unknown; status?: unknown }
      | null
      | undefined,
  ) => {
    if (
      item?.type === "image_generation_call" &&
      typeof item.result === "string" &&
      item.status !== "failed"
    )
      image ??= item.result;
  };
  const dispatch = () => {
    if (!lines.length) return;
    const text = lines.join("\n");
    lines = [];
    eventSize = 0;
    if (text === "[DONE]") return;
    const event = JSON.parse(text) as {
      type?: string;
      item?: { type?: unknown; result?: unknown; status?: unknown };
      response?: {
        output?: { type?: unknown; result?: unknown; status?: unknown }[];
        status?: string;
      };
    };
    if (!event || typeof event !== "object") throw new Error("Invalid event");
    if (
      ["error", "response.failed", "response.incomplete"].includes(
        event.type ?? "",
      ) ||
      ["failed", "incomplete"].includes(event.response?.status ?? "")
    )
      throw new DyadError(
        "ChatGPT subscription image generation was rejected or incomplete. Check plan/model availability; no API fallback was attempted.",
        DyadErrorKind.External,
      );
    if (event.type === "response.output_item.done") remember(event.item);
    if (event.type === "response.completed") {
      if (Array.isArray(event.response?.output))
        for (const item of event.response.output) remember(item);
      completed = true;
    }
  };
  const line = (value: string) => {
    if (value.endsWith("\r")) value = value.slice(0, -1);
    if (!value) {
      dispatch();
      return;
    }
    if (value.startsWith("data:")) {
      const data = value.slice(5).trimStart();
      eventSize += data.length;
      if (eventSize > MAX_JSON_BYTES)
        throw new DyadError(
          "ChatGPT image event exceeds maximum allowed size",
          DyadErrorKind.Validation,
        );
      lines.push(data);
    }
  };
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        buffer += decoder.decode();
        if (buffer) line(buffer);
        dispatch();
        break;
      }
      total += value.byteLength;
      if (total > 64 * 1024 * 1024)
        throw new DyadError(
          "ChatGPT image stream exceeds maximum allowed size",
          DyadErrorKind.Validation,
        );
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (completed) break;
      }
      if (completed) break;
      if (buffer.length > MAX_JSON_BYTES)
        throw new DyadError(
          "ChatGPT image event exceeds maximum allowed size",
          DyadErrorKind.Validation,
        );
    }
    if (!completed || !image)
      throw new DyadError(
        "ChatGPT did not complete an image. This account/model may not support image generation; no API fallback was attempted.",
        DyadErrorKind.External,
      );
    return image;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
