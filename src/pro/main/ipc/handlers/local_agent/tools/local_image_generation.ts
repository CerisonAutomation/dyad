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
    logger.warn("Pollinations.ai failed:", error);
  }

  // Fallback: Generate placeholder image
  const result = generatePlaceholderImage(prompt, width, height);
  const elapsed = Date.now() - startTime;
  logger.log(`Generated placeholder image in ${elapsed}ms`);
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
    throw new DyadError(
      `Pollinations.ai returned ${response.status}`,
      DyadErrorKind.External,
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
