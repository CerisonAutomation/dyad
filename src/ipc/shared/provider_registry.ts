/**
 * The single source of truth for provider identity.
 *
 * Provider facts used to be written out separately wherever they were needed,
 * and the copies drifted. Concretely, before this file existed:
 *
 *   - `vertex` was "Google Vertex AI" in the settings page and "Vertex" in the
 *     picker; `minimax` rendered as the lowercase string "minimax" in the
 *     picker while the settings page said "MiniMax".
 *   - `azure`, `xai` and `bedrock` had no picker badge at all, so dense model
 *     rows fell through to printing the raw provider id.
 *   - `kilocode` shipped a working client, a picker badge and 400+ catalog
 *     models, but had no `PROVIDER_TO_ENV_VAR` entry, so a Kilo key could
 *     never be detected from the environment.
 *   - `schemas.ts` listed twelve providers and had silently lost `opencode`
 *     and `kilocode`, both of which work.
 *   - The set of providers whose key gets verified was written twice, once as
 *     `VALIDATED_API_KEY_PROVIDERS` in the settings page and once as a zod
 *     enum in `ipc/types/settings.ts`, with nothing keeping them in step.
 *   - `https://openrouter.ai/api/v1` was a literal in two different modules.
 *
 * Declaring a provider used to mean six coordinated edits, and nothing failed
 * if you made five. Every provider-level list the app needs is now DERIVED
 * from `PROVIDERS` below, so a provider is declared exactly once and
 * `provider_registry.spec.ts` fails the build if an entry is incomplete.
 *
 * The record shape follows the ecosystem's canonical provider descriptor (as
 * used by models.dev and the AI SDK provider registry): a display name, the
 * package/protocol that speaks to it, the environment variables that
 * authenticate it, its API base URL, and its docs URL. Two deliberate
 * departures: `envVars` is a list because Azure genuinely needs two, and no
 * provider logo URL is fetched remotely — this app makes no outbound calls to
 * a third-party metadata service, so brand marks stay inline SVGs in
 * `components/ProviderIcon.tsx`.
 *
 * This module must stay dependency-free: it is imported from the renderer, the
 * main process and the test harness, so it cannot import React, electron, or
 * anything that imports it back.
 */

/** Icon brands a provider can be drawn as. The renderer maps these to glyphs. */
export type ProviderIconBrand =
  | "anthropic"
  | "openai"
  | "gemini"
  | "grok"
  | "openrouter"
  | "deepseek"
  | "minimax"
  | "bedrock"
  | "azure"
  | "dyad"
  | "ollama"
  | "lmstudio"
  | "custom";

/** How a provider's requests reach the model. */
export type WireProtocol =
  | "openai-responses"
  | "openai-compatible"
  | "anthropic-messages"
  | "google-generative"
  | "google-vertex"
  | "amazon-bedrock"
  | "azure-openai"
  | "xai"
  | "dyad-engine"
  | "opencode-multiplex"
  | "ollama"
  | "lmstudio";

/**
 * Where a provider's model list comes from. `registry` means it is written out
 * in `MODEL_OPTIONS`; `remote-catalog` means the fetched catalog owns it and
 * `MODEL_OPTIONS` is only a fallback; `live-discovery` means the list is read
 * from the provider at runtime.
 */
export type ModelSource = "registry" | "remote-catalog" | "live-discovery";

export interface ProviderDescriptor {
  /** Canonical user-facing name. Settings, pickers and error messages read this. */
  readonly displayName: string;
  /** Short form for dense model-picker rows. Falls back to `displayName`. */
  readonly badge?: string;
  readonly kind: "cloud" | "local";
  readonly models: ModelSource;
  readonly icon: ProviderIconBrand;
  readonly wire: WireProtocol;
  /** Fixed cloud endpoint. Omit where the SDK default or runtime config applies. */
  readonly baseURL?: string;
  /**
   * Environment variables that authenticate this provider. Every entry must be
   * set for the provider to count as configured from the environment. Absent
   * when the provider authenticates another way (Vertex service accounts) or
   * when no variable is documented for it.
   */
  readonly envVars?: readonly string[];
  /** URL a user visits to create a key. */
  readonly websiteUrl?: string;
  /**
   * Routing prefix for the hosted Dyad engine. Kept as `""` rather than absent
   * for providers the engine serves directly, because the engine gate tests
   * `gatewayPrefix != null` — absent and empty are not interchangeable.
   */
  readonly gatewayPrefix?: string;
  /** Rendered in the picker's secondary group, and kept out of the Pro upsell row. */
  readonly secondary?: boolean;
  readonly hasFreeTier?: boolean;
  /** Whether the settings page spends a live request verifying a key before saving. */
  readonly verifiesApiKey?: boolean;
  /**
   * Model id to spend that key check on. Omitted when the id has to be
   * resolved at runtime (OpenCode Zen publishes its list live).
   */
  readonly apiKeyValidationModel?: string;
}

/**
 * Shared endpoints, named so each literal exists once. `opencode_gateway.ts`
 * re-exports `OPENCODE_BASE_URL` from here.
 */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const MINIMAX_BASE_URL = "https://api.minimax.io/v1";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const KILO_BASE_URL = "https://api.kilo.ai/api/gateway";
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

export const PROVIDERS = {
  openai: {
    displayName: "OpenAI",
    kind: "cloud",
    models: "remote-catalog",
    icon: "openai",
    wire: "openai-responses",
    // The API root, used for live `/models` discovery.
    baseURL: "https://api.openai.com/v1",
    envVars: ["OPENAI_API_KEY"],
    websiteUrl: "https://platform.openai.com/api-keys",
    gatewayPrefix: "",
    hasFreeTier: false,
  },
  anthropic: {
    displayName: "Anthropic",
    kind: "cloud",
    models: "remote-catalog",
    icon: "anthropic",
    wire: "anthropic-messages",
    envVars: ["ANTHROPIC_API_KEY"],
    websiteUrl: "https://console.anthropic.com/settings/keys",
    gatewayPrefix: "anthropic/",
    hasFreeTier: false,
  },
  opencode: {
    displayName: "OpenCode Zen",
    kind: "cloud",
    models: "live-discovery",
    icon: "custom",
    wire: "opencode-multiplex",
    baseURL: OPENCODE_BASE_URL,
    envVars: ["OPENCODE_API_KEY"],
    websiteUrl: "https://opencode.ai/docs/go/",
    gatewayPrefix: "opencode/",
    hasFreeTier: true,
    verifiesApiKey: true,
  },
  google: {
    displayName: "Google",
    kind: "cloud",
    models: "remote-catalog",
    icon: "gemini",
    wire: "google-generative",
    envVars: ["GEMINI_API_KEY"],
    websiteUrl: "https://aistudio.google.com/api-keys",
    gatewayPrefix: "gemini/",
    hasFreeTier: true,
    verifiesApiKey: true,
    apiKeyValidationModel: "gemini-flash-latest",
  },
  vertex: {
    displayName: "Google Vertex AI",
    badge: "Vertex",
    kind: "cloud",
    models: "remote-catalog",
    icon: "gemini",
    wire: "google-vertex",
    websiteUrl: "https://console.cloud.google.com/vertex-ai",
    // Shares Google's prefix so the hosted engine treats it as Gemini.
    gatewayPrefix: "gemini/",
    secondary: true,
    hasFreeTier: false,
  },
  openrouter: {
    displayName: "OpenRouter",
    kind: "cloud",
    models: "remote-catalog",
    icon: "openrouter",
    wire: "openai-compatible",
    baseURL: OPENROUTER_BASE_URL,
    envVars: ["OPENROUTER_API_KEY"],
    websiteUrl: "https://openrouter.ai/settings/keys",
    gatewayPrefix: "openrouter/",
    hasFreeTier: true,
    verifiesApiKey: true,
    apiKeyValidationModel: "openrouter/free",
  },
  auto: {
    displayName: "Dyad",
    kind: "cloud",
    // MODEL_OPTIONS.auto is deliberately empty because the hosted router is
    // disabled; the auto aliases are re-injected from the remote catalog.
    models: "remote-catalog",
    icon: "dyad",
    wire: "dyad-engine",
    websiteUrl: "https://academy.dyad.sh/subscription",
    gatewayPrefix: "dyad/",
  },
  azure: {
    displayName: "Azure OpenAI",
    badge: "Azure",
    kind: "cloud",
    models: "registry",
    icon: "azure",
    wire: "azure-openai",
    // Both are required: a key alone cannot address a resource.
    envVars: ["AZURE_API_KEY", "AZURE_RESOURCE_NAME"],
    websiteUrl: "https://portal.azure.com/",
    gatewayPrefix: "",
    secondary: true,
    hasFreeTier: false,
  },
  xai: {
    displayName: "xAI",
    kind: "cloud",
    models: "registry",
    icon: "grok",
    wire: "xai",
    // The API root, used for live `/models` discovery.
    baseURL: "https://api.x.ai/v1",
    envVars: ["XAI_API_KEY"],
    websiteUrl: "https://console.x.ai/",
    gatewayPrefix: "xai/",
    secondary: true,
    hasFreeTier: false,
  },
  bedrock: {
    displayName: "AWS Bedrock",
    badge: "Bedrock",
    kind: "cloud",
    models: "registry",
    icon: "bedrock",
    wire: "amazon-bedrock",
    envVars: ["AWS_BEARER_TOKEN_BEDROCK"],
    websiteUrl: "https://console.aws.amazon.com/bedrock/",
    gatewayPrefix: "bedrock/",
    secondary: true,
    hasFreeTier: false,
  },
  minimax: {
    displayName: "MiniMax",
    kind: "cloud",
    models: "registry",
    icon: "minimax",
    wire: "openai-compatible",
    baseURL: MINIMAX_BASE_URL,
    envVars: ["MINIMAX_API_KEY"],
    websiteUrl: "https://platform.minimax.io/",
    gatewayPrefix: "minimax/",
    secondary: true,
    hasFreeTier: false,
  },
  deepseek: {
    displayName: "DeepSeek",
    kind: "cloud",
    models: "registry",
    icon: "deepseek",
    wire: "openai-compatible",
    baseURL: DEEPSEEK_BASE_URL,
    envVars: ["DEEPSEEK_API_KEY"],
    websiteUrl: "https://platform.deepseek.com/api_keys",
    gatewayPrefix: "deepseek/",
    secondary: true,
    hasFreeTier: false,
  },
  kilocode: {
    displayName: "Kilo Code",
    badge: "Kilo",
    kind: "cloud",
    models: "remote-catalog",
    icon: "custom",
    wire: "openai-compatible",
    baseURL: KILO_BASE_URL,
    // No environment variable is documented for Kilo, so a key pasted into
    // settings is the only supported source. Leaving this absent keeps that
    // behaviour honest instead of inventing a name that would never be set.
    hasFreeTier: true,
  },
  ollama: {
    displayName: "Ollama",
    kind: "local",
    models: "live-discovery",
    icon: "ollama",
    wire: "ollama",
    hasFreeTier: true,
  },
  lmstudio: {
    displayName: "LM Studio",
    kind: "local",
    models: "live-discovery",
    icon: "lmstudio",
    wire: "lmstudio",
    hasFreeTier: true,
  },
  omlx: {
    displayName: "oMLX",
    kind: "local",
    models: "live-discovery",
    icon: "custom",
    wire: "openai-compatible",
    hasFreeTier: true,
  },
} as const satisfies Record<string, ProviderDescriptor>;
export type ProviderId = keyof typeof PROVIDERS;

/**
 * The registry widened to its declared interface. Indexing `PROVIDERS` directly
 * would give the union of its `as const` literal types, on which an optional
 * field that only some entries declare (say `verifiesApiKey`) is not readable.
 * Widening once here is the only cast in this module.
 */
const DESCRIPTORS: [string, ProviderDescriptor][] = Object.entries(
  PROVIDERS as Record<string, ProviderDescriptor>,
);

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export const CLOUD_PROVIDER_IDS: string[] = DESCRIPTORS.filter(
  ([, provider]) => provider.kind === "cloud",
).map(([id]) => id);

export const LOCAL_PROVIDER_IDS: string[] = DESCRIPTORS.filter(
  ([, provider]) => provider.kind === "local",
).map(([id]) => id);

export function getProviderDescriptor(
  id: string,
): ProviderDescriptor | undefined {
  return (PROVIDERS as Record<string, ProviderDescriptor>)[id];
}

/** Canonical name for a provider id, falling back to the id itself. */
export function getProviderDisplayName(id: string): string {
  return getProviderDescriptor(id)?.displayName ?? id;
}

/** Dense-row label for a provider id, or `undefined` when the id is unknown. */
export function getProviderBadge(id: string): string | undefined {
  const descriptor = getProviderDescriptor(id);
  return descriptor ? (descriptor.badge ?? descriptor.displayName) : undefined;
}

export function getProviderIconBrand(
  id: string,
): ProviderIconBrand | undefined {
  return getProviderDescriptor(id)?.icon;
}

export function getProviderBaseURL(id: string): string | undefined {
  return getProviderDescriptor(id)?.baseURL;
}

export function getProviderEnvVars(id: string): readonly string[] {
  return getProviderDescriptor(id)?.envVars ?? [];
}

/** True when every environment variable this provider needs is present. */
export function isProviderConfiguredFromEnv(
  id: string,
  envVars: Record<string, string | undefined>,
): boolean {
  const required = getProviderEnvVars(id);
  return (
    required.length > 0 && required.every((name) => Boolean(envVars[name]))
  );
}

/**
 * The registry keys that opt into live key verification, resolved at the type
 * level so the resulting union stays literal. Typing this as `string[]` would
 * collapse `ProviderApiKeyValidationProvider` to `string` and silently remove
 * the exhaustiveness check from the validation switch.
 */
type VerifiableProviderId = {
  [K in ProviderId]: (typeof PROVIDERS)[K] extends { verifiesApiKey: true }
    ? K
    : never;
}[ProviderId];

/**
 * Providers whose API key the settings page verifies with a live request.
 * Feeds both the renderer gate and the IPC input schema, which used to be two
 * hand-synchronised lists.
 *
 * The cast restores the non-empty tuple `z.enum` needs; `.filter` cannot
 * express one. A registry with no verifiable provider is a mistake the guard
 * spec catches, not a case to encode here.
 */
export const VERIFIABLE_PROVIDER_IDS = DESCRIPTORS.filter(
  ([, provider]) => provider.verifiesApiKey === true,
).map(([id]) => id as VerifiableProviderId) as [
  VerifiableProviderId,
  ...VerifiableProviderId[],
];

/** Provider-level lists, derived so no second copy can drift. */
export const PROVIDER_TO_ENV_VAR: Record<string, string> = Object.fromEntries(
  DESCRIPTORS.flatMap(([id, provider]) => {
    const primary = provider.envVars?.[0];
    return primary ? [[id, primary]] : [];
  }),
);

export const CLOUD_PROVIDERS: Record<
  string,
  {
    displayName: string;
    hasFreeTier?: boolean;
    websiteUrl?: string;
    gatewayPrefix?: string;
    secondary?: boolean;
  }
> = Object.fromEntries(
  DESCRIPTORS.filter(([, provider]) => provider.kind === "cloud").map(
    ([id, provider]) => [
      id,
      {
        displayName: provider.displayName,
        hasFreeTier: provider.hasFreeTier,
        websiteUrl: provider.websiteUrl,
        // Passed through rather than defaulted: the engine gate tests
        // `gatewayPrefix != null`, so "" and an absent prefix mean different
        // things. OpenAI and Azure are "" (engine-served) and keep routing
        // there; Kilo has no prefix at all and must not be pulled in.
        gatewayPrefix: provider.gatewayPrefix,
        secondary: provider.secondary,
      },
    ],
  ),
);

export const LOCAL_PROVIDERS: Record<
  string,
  {
    displayName: string;
    hasFreeTier: boolean;
  }
> = Object.fromEntries(
  DESCRIPTORS.filter(([, provider]) => provider.kind === "local").map(
    ([id, provider]) => [
      id,
      {
        displayName: provider.displayName,
        hasFreeTier: provider.hasFreeTier ?? false,
      },
    ],
  ),
);
