import log from "electron-log";
import type { LanguageModel } from "@/ipc/types/language-model";
import { isFreeModelName } from "@/lib/freeModel";
import { MODEL_OPTIONS } from "./language_model_constants";
import { isOpenCodeBaseUrl, OPENCODE_MODELS_URL } from "./opencode_gateway";

const logger = log.scope("opencode_model_discovery");

const DISCOVERY_TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
// A failed refresh must not pin an empty list for a whole hour, but it also
// must not retry on every single picker render. One minute is long enough to
// stop the hammering and short enough that a transient outage self-heals.
const DISCOVERY_FAILURE_TTL_MS = 60 * 1000;

/**
 * Metadata fallbacks for models the gateway lists but Dyad has never priced.
 * The list endpoint returns only `{ id, object, created, owned_by }`, so there
 * is nothing to read a context window from. These are deliberately
 * conservative: an understated context window makes Dyad trim earlier than it
 * could, which costs a little quality, while an overstated one produces a hard
 * context-overflow failure mid-conversation.
 */
const UNKNOWN_MODEL_DEFAULTS = {
  contextWindow: 128_000,
  maxOutputTokens: 32_000,
  temperature: 0,
  dollarSigns: 2,
} as const;

export function getOpenCodeModelsDiscoveryUrl(): string {
  if (process.env.DYAD_OPENCODE_MODELS_URL) {
    return process.env.DYAD_OPENCODE_MODELS_URL;
  }

  if (process.env.E2E_TEST_BUILD === "true" && process.env.FAKE_LLM_PORT) {
    return `http://localhost:${process.env.FAKE_LLM_PORT}/opencode/v1/models`;
  }

  return OPENCODE_MODELS_URL;
}

/**
 * The models endpoint for a provider that reaches OpenCode through a custom
 * base URL, or `null` when the base URL is not the OpenCode gateway.
 *
 * A user who adds OpenCode Zen as a custom provider must see the same live
 * model list as the built-in `opencode` provider; discovery used to key on the
 * provider id, so a `custom::opencode` provider was frozen at whatever rows
 * happened to be in the database and never refreshed.
 *
 * Deliberately returns `null` for a missing base URL: several built-in
 * providers (OpenAI, Anthropic, …) carry no `apiBaseUrl`, and defaulting them
 * to the OpenCode endpoint would point discovery at the wrong gateway.
 */
export function openCodeModelsUrlForBaseUrl(
  baseUrl: string | null | undefined,
): string | null {
  if (!baseUrl || !isOpenCodeBaseUrl(baseUrl)) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/** "glm-5.3-flash" -> "GLM 5.3 Flash" */
export function prettifyOpenCodeModelId(modelId: string): string {
  return modelId
    .split("-")
    .map((part) =>
      /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

/**
 * Dyad's own metadata for the OpenCode models it ships, keyed by model id.
 *
 * Read straight out of the constants module rather than scraped out of the
 * source text the way the external sync script does — that scrape was a regex
 * over a file path inside a different checkout, so it silently enriched
 * nothing whenever that checkout was absent or had moved.
 */
export function buildOpenCodeMetadataIndex(): Map<
  string,
  (typeof MODEL_OPTIONS)["opencode"][number]
> {
  const index = new Map<string, (typeof MODEL_OPTIONS)["opencode"][number]>();
  for (const model of MODEL_OPTIONS.opencode ?? []) {
    index.set(model.name, model);
  }
  return index;
}

/**
 * The `owned_by` field from the gateway's `/models` response, mapped to the
 * wire protocol that provider's models speak. The gateway multiplexes three
 * protocols behind one host; `owned_by` tells us which upstream serves the
 * model, so we can pick the right factory without a hardcoded per-model map.
 *
 * Models whose `owned_by` is unrecognized default to chat/completions (the
 * gateway's own default), which is the safest assumption for any provider
 * not listed here.
 */
export function protocolForOwnedBy(
  ownedBy: string | undefined,
): "chat-completions" | "responses" | "messages" {
  if (!ownedBy) return "chat-completions";
  const normalized = ownedBy.toLowerCase().trim();
  if (normalized.includes("anthropic")) return "messages";
  if (normalized.includes("openai")) return "responses";
  if (normalized.includes("google") || normalized.includes("gemini"))
    return "messages";
  if (normalized.includes("mistral")) return "messages";
  return "chat-completions";
}

/**
 * Parse the gateway's `{ object, data: [...] }` list payload into Dyad's model
 * shape, enriching against known metadata. Pure so it can be tested without a
 * network stub.
 *
 * The `owned_by` field on each entry is captured and exposed via
 * `normalizeOpenCodeModelsPayloadWithMeta` so the router can pick the right
 * wire protocol for models that are not in the hardcoded OPENCODE_ROUTES map.
 */
export function normalizeOpenCodeModelsPayload(
  payload: unknown,
  metadata: Map<string, (typeof MODEL_OPTIONS)["opencode"][number]>,
): LanguageModel[] {
  return normalizeOpenCodeModelsPayloadWithMeta(payload, metadata).models;
}

export interface DiscoveredOpenCodeModel {
  model: LanguageModel;
  ownedBy: string | undefined;
}

/**
 * Same as `normalizeOpenCodeModelsPayload` but also returns the raw `owned_by`
 * for each model, so the caller can determine the wire protocol dynamically.
 */
export function normalizeOpenCodeModelsPayloadWithMeta(
  payload: unknown,
  metadata: Map<string, (typeof MODEL_OPTIONS)["opencode"][number]>,
): { models: LanguageModel[]; discovered: DiscoveredOpenCodeModel[] } {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    throw new Error("unexpected OpenCode models payload shape");
  }

  const models: LanguageModel[] = [];
  const discovered: DiscoveredOpenCodeModel[] = [];
  const seen = new Set<string>();

  for (const entry of (payload as { data: unknown[] }).data) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { id?: unknown; owned_by?: unknown };
    const apiName = record.id;
    if (typeof apiName !== "string" || apiName.trim() === "") {
      logger.warn("Skipping OpenCode model entry without a usable id");
      continue;
    }
    // The gateway has been known to list a model twice with different casing
    // in its owned_by field; key on the id so the picker cannot show the same
    // model twice.
    if (seen.has(apiName)) {
      continue;
    }
    seen.add(apiName);

    const ownedBy =
      typeof record.owned_by === "string" ? record.owned_by : undefined;
    const known = metadata.get(apiName);
    const free = isFreeModelName(apiName);
    const model: LanguageModel = {
      apiName,
      displayName: known?.displayName ?? prettifyOpenCodeModelId(apiName),
      description:
        known?.description ??
        `${prettifyOpenCodeModelId(apiName)} via OpenCode Zen.`,
      tag: known?.tag,
      tagColor: known?.tagColor,
      dollarSigns: free
        ? 0
        : (known?.dollarSigns ?? UNKNOWN_MODEL_DEFAULTS.dollarSigns),
      temperature: known?.temperature ?? UNKNOWN_MODEL_DEFAULTS.temperature,
      contextWindow:
        known?.contextWindow ?? UNKNOWN_MODEL_DEFAULTS.contextWindow,
      maxOutputTokens:
        known?.maxOutputTokens ?? UNKNOWN_MODEL_DEFAULTS.maxOutputTokens,
      effortSettings: known?.effortSettings,
      type: "cloud",
    };
    models.push(model);
    discovered.push({ model, ownedBy });
  }

  return { models, discovered };
}

interface DiscoveryCacheEntry {
  models: LanguageModel[];
  ownedBy: Map<string, string | undefined>;
  expiresAt: number;
}

// Keyed by models URL, not a single slot: the built-in `opencode` provider and
// a custom OpenCode provider can point at different surfaces (the gateway's
// `/go` list is 43 models, its full `/zen` list is 86), so one shared entry
// would hand the wrong catalog to one of them.
const discoveryCache = new Map<string, DiscoveryCacheEntry>();
const discoveryInflight = new Map<string, Promise<LanguageModel[]>>();

async function fetchOpenCodeModels(
  modelsUrl: string,
): Promise<LanguageModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      // The list endpoint answers anonymously, exactly like Kilo's gateway, so
      // the key is not required to learn which models exist. Keeping settings
      // out of this fetch is what lets the shared layer own it.
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const { models, discovered } = normalizeOpenCodeModelsPayloadWithMeta(
      await response.json(),
      buildOpenCodeMetadataIndex(),
    );
    // Store the owned_by mapping so the router can pick the right protocol
    // for models that are not in the hardcoded OPENCODE_ROUTES map.
    const ownedBy = new Map<string, string | undefined>();
    for (const { model, ownedBy: ob } of discovered) {
      ownedBy.set(model.apiName, ob);
    }
    const entry: DiscoveryCacheEntry = {
      models,
      ownedBy,
      expiresAt: Date.now() + DISCOVERY_TTL_MS,
    };
    // Replace the cache entry atomically so readers never see a half-populated map.
    discoveryCache.set(modelsUrl, entry);
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `owned_by` value the gateway reported for a model, or `undefined` when
 * the model has never been discovered. Used by the router to pick the wire
 * protocol for models that are not in the hardcoded OPENCODE_ROUTES map.
 */
export function getOwnedByForDiscoveredModel(
  modelsUrl: string,
  modelName: string,
): string | undefined {
  const entry = discoveryCache.get(modelsUrl);
  return entry?.ownedBy.get(modelName);
}

/**
 * Discover the models behind one OpenCode models URL, caching per URL.
 *
 * Returns `null` when discovery has never succeeded for that URL. Callers must
 * treat `null` as "keep whatever the catalog already gave you" — an
 * unreachable gateway must never empty the model picker.
 */
async function discoverOpenCodeModels(
  modelsUrl: string,
): Promise<LanguageModel[] | null> {
  const now = Date.now();
  const cached = discoveryCache.get(modelsUrl);
  if (cached && cached.expiresAt > now) {
    return cached.models.length > 0 ? cached.models : null;
  }

  const inFlight = discoveryInflight.get(modelsUrl);
  if (inFlight) {
    const shared = await inFlight;
    return shared.length > 0 ? shared : null;
  }

  const inflight = (async () => {
    try {
      const models = await fetchOpenCodeModels(modelsUrl);
      logger.debug(`Discovered ${models.length} OpenCode models`, {
        modelsUrl,
      });
      return models;
    } catch (error) {
      logger.warn("OpenCode model discovery failed", error);
      // Serve the last good list through the outage instead of dropping it.
      const lastGood = discoveryCache.get(modelsUrl);
      if (lastGood) {
        discoveryCache.set(modelsUrl, {
          ...lastGood,
          expiresAt: Date.now() + DISCOVERY_FAILURE_TTL_MS,
        });
        return lastGood.models;
      }
      return [];
    } finally {
      discoveryInflight.delete(modelsUrl);
    }
  })();

  discoveryInflight.set(modelsUrl, inflight);
  const resolved = await inflight;
  return resolved.length > 0 ? resolved : null;
}

/**
 * The OpenCode model list for the built-in gateway as it currently reports it,
 * or `null` when discovery has never succeeded.
 */
export async function getDiscoveredOpenCodeModels(): Promise<
  LanguageModel[] | null
> {
  return discoverOpenCodeModels(getOpenCodeModelsDiscoveryUrl());
}

/**
 * The model list behind an arbitrary OpenCode models URL (a custom provider's
 * endpoint), or `null` when the URL is unknown or discovery has never
 * succeeded.
 */
export async function getDiscoveredOpenCodeModelsFor(
  modelsUrl: string | null,
): Promise<LanguageModel[] | null> {
  if (!modelsUrl) {
    return null;
  }
  return discoverOpenCodeModels(modelsUrl);
}

/** Test seam: drops every cached list so a test can drive discovery afresh. */
export function resetOpenCodeModelDiscoveryCache(): void {
  discoveryCache.clear();
  discoveryInflight.clear();
}
