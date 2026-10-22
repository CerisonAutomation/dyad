/**
 * Local Image Generation - Free, no-API-key alternatives
 * Replaces Dyad Engine image generation with free providers
 *
 * Providers (in order of preference):
 * - Pollinations.ai (free, no API key)
 * - Placeholder images (always available)
 */

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("local_image_generation");

export interface ImageGenerationResult {
  url: string;
  prompt: string;
  provider: string;
  width: number;
  height: number;
  /**
   * Set when the real provider failed and a placeholder image was returned
   * instead, so callers can tell the model that no real image was generated.
   */
  fallbackReason?: string;
}

export interface ImageGenerationOptions {
  prompt: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
}

/**
 * Generate an image using free providers
 * @param options - Generation options
 * @returns Generated image URL
 */
export async function localImageGeneration(
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const { prompt, width = 512, height = 512, negativePrompt } = options;

  const startTime = Date.now();

  // Try Pollinations.ai (free, no API key)
  let providerFailure: string | undefined;
  try {
    const result = await generateWithPollinations(
      prompt,
      width,
      height,
      negativePrompt,
    );
    const elapsed = Date.now() - startTime;
    logger.log(`Image generated in ${elapsed}ms via ${result.provider}`);
    return result;
  } catch (error) {
    // An auth or billing failure is not something a placeholder can paper
    // over, so let it reach the caller instead.
    if (
      error instanceof DyadError &&
      (error.kind === DyadErrorKind.Auth ||
        error.kind === DyadErrorKind.Precondition)
    ) {
      throw error;
    }
    logger.warn("Pollinations.ai failed:", error);
    providerFailure = error instanceof Error ? error.message : String(error);
  }

  // Fallback: Generate placeholder image. The failure reason travels with the
  // result so the caller can tell the model that this is a placeholder rather
  // than a generated image.
  const result = generatePlaceholderImage(prompt, width, height);
  result.fallbackReason = providerFailure;
  const elapsed = Date.now() - startTime;
  logger.log(
    `Generated placeholder image in ${elapsed}ms (provider failed: ${providerFailure})`,
  );
  return result;
}

/**
 * Generate image using Pollinations.ai (free, no API key)
 */
async function generateWithPollinations(
  prompt: string,
  width: number,
  height: number,
  negativePrompt?: string,
): Promise<ImageGenerationResult> {
  // Pollinations.ai URL pattern
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(Math.floor(Math.random() * 1000000)),
  });

  if (negativePrompt) {
    params.set("negative", negativePrompt);
  }

  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}`;

  // Verify the image is accessible
  const response = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(30000), // 30 second timeout for image generation
  });

  if (!response.ok) {
    const { kind, hint } = classifyImageProviderStatus(response.status);
    throw new DyadError(
      `Pollinations.ai returned ${response.status}. ${hint}`,
      kind,
    );
  }

  return {
    url,
    prompt,
    provider: "pollinations",
    width,
    height,
  };
}

/**
 * Generate a placeholder image (always available)
 */
function generatePlaceholderImage(
  prompt: string,
  width: number,
  height: number,
): ImageGenerationResult {
  // Use a simple SVG placeholder
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#1a1a2e"/>
      <rect x="10%" y="10%" width="80%" height="80%" rx="10" fill="#16213e"/>
      <text x="50%" y="40%" font-family="Arial, sans-serif" font-size="14" fill="#e94560" text-anchor="middle" dominant-baseline="middle">
        ${prompt.substring(0, 30)}${prompt.length > 30 ? "..." : ""}
      </text>
      <text x="50%" y="60%" font-family="Arial, sans-serif" font-size="10" fill="#0f3460" text-anchor="middle" dominant-baseline="middle">
        [Image Generation]
      </text>
    </svg>
  `;

  // Convert SVG to data URL
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return {
    url: dataUrl,
    prompt,
    provider: "placeholder",
    width,
    height,
  };
}

/**
 * Format image generation result for display
 */
export function formatImageResult(result: ImageGenerationResult): string {
  return `**Generated Image**\nPrompt: ${result.prompt}\nSize: ${result.width}x${result.height}\nProvider: ${result.provider}\nURL: ${result.url}`;
}

/**
 * Map an image-provider HTTP status to a Dyad error kind plus a hint the
 * model can act on. A billing or auth failure must not be papered over
 * with a placeholder image.
 */
export function classifyImageProviderStatus(
  status: number,
  phase: "generate" | "download" = "generate",
): {
  kind: DyadErrorKind;
  hint: string;
} {
  if (status === 401 || status === 403) {
    if (phase === "download") {
      // The provider refused the fetch of an already-generated image. That is
      // an external failure, not a missing credential, and it has to stay
      // reportable: `Auth` is filtered out of exception telemetry.
      return {
        kind: DyadErrorKind.External,
        hint: "The image provider rejected the download, so the generated image is not reachable. The URL may have expired; generate the image again.",
      };
    }
    return {
      kind: DyadErrorKind.Auth,
      hint: "The image provider rejected the request. It now needs a token or credit for this account; add a token in Settings or use a different image provider.",
    };
  }
  if (status === 402) {
    return {
      kind: DyadErrorKind.Precondition,
      hint: "Payment required: the image provider account has no credit left. Top up the provider account or add a token. Dyad does not return a placeholder image here because that would hide the billing problem.",
    };
  }
  if (status === 404) {
    if (phase === "download") {
      return {
        kind: DyadErrorKind.NotFound,
        hint: "The generated image URL is no longer available.",
      };
    }
    return {
      kind: DyadErrorKind.External,
      hint: "The image provider has no such model or route. Pick a different model or image provider.",
    };
  }
  if (status === 429) {
    return {
      kind: DyadErrorKind.External,
      hint: "The image provider is rate limiting this request; retry in a few seconds.",
    };
  }
  if (status >= 500) {
    return {
      kind: DyadErrorKind.External,
      hint: "The image provider had a server error; retrying may work.",
    };
  }
  return { kind: DyadErrorKind.External, hint: "" };
}
