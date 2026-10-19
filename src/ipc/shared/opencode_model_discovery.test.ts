import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isFreeModelName } from "@/lib/freeModel";
import { MODEL_OPTIONS } from "./language_model_constants";
import {
  buildOpenCodeMetadataIndex,
  getDiscoveredOpenCodeModels,
  getDiscoveredOpenCodeModelsFor,
  normalizeOpenCodeModelsPayload,
  openCodeModelsUrlForBaseUrl,
  prettifyOpenCodeModelId,
  resetOpenCodeModelDiscoveryCache,
} from "./opencode_model_discovery";

const metadata = buildOpenCodeMetadataIndex();

function payload(ids: unknown[]): unknown {
  return { object: "list", data: ids.map((id) => ({ id, object: "model" })) };
}

describe("OpenCode model id helpers", () => {
  it("prettifies an id whose numeric parts must stay untouched", () => {
    expect(prettifyOpenCodeModelId("muse-spark-1.3-contributor")).toBe(
      "Muse Spark 1.3 Contributor",
    );
  });

  it("treats the gateway's free suffix as free", () => {
    expect(isFreeModelName("longcat-2.5-preview-free")).toBe(true);
    expect(isFreeModelName("mimo-v2-pro")).toBe(false);
  });
});

describe("buildOpenCodeMetadataIndex", () => {
  it("indexes every shipped OpenCode constant by model id", () => {
    expect(metadata.size).toBe(MODEL_OPTIONS.opencode.length);
    expect(metadata.get("longcat-2.5-preview-free")?.displayName).toBe(
      "LongCat 2.5 Preview (Free)",
    );
  });
});

describe("normalizeOpenCodeModelsPayload", () => {
  it("maps the gateway list into Dyad model entries", () => {
    const models = normalizeOpenCodeModelsPayload(
      payload(["glm-5.3"]),
      metadata,
    );
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      apiName: "glm-5.3",
      displayName: "Glm 5.3",
      type: "cloud",
      dollarSigns: 2,
    });
  });

  it("enriches a known model from Dyad's own metadata", () => {
    const [model] = normalizeOpenCodeModelsPayload(
      payload(["longcat-2.5-preview-free"]),
      metadata,
    );
    expect(model).toMatchObject({
      displayName: "LongCat 2.5 Preview (Free)",
      description: "OpenCode's free preview model",
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
      dollarSigns: 0,
    });
  });

  it("gives an unknown model conservative defaults rather than nothing", () => {
    const [model] = normalizeOpenCodeModelsPayload(
      payload(["brand-new-model"]),
      metadata,
    );
    expect(model).toMatchObject({
      apiName: "brand-new-model",
      displayName: "Brand New Model",
      description: "Brand New Model via OpenCode Zen.",
      contextWindow: 128_000,
      maxOutputTokens: 32_000,
      dollarSigns: 2,
      type: "cloud",
    });
  });

  it("reports a free model as free even when metadata prices it", () => {
    const priced = new Map([
      [
        "longcat-2.5-preview-free",
        {
          ...MODEL_OPTIONS.opencode[0],
          name: "longcat-2.5-preview-free",
          dollarSigns: 3,
        },
      ],
    ]);
    const [model] = normalizeOpenCodeModelsPayload(
      payload(["longcat-2.5-preview-free"]),
      priced,
    );
    expect(model.dollarSigns).toBe(0);
  });

  it("skips entries with no usable id and de-duplicates repeats", () => {
    const models = normalizeOpenCodeModelsPayload(
      {
        data: [
          { id: "one" },
          { id: "one" },
          { object: "model" },
          { id: "  " },
          null,
          { id: "two" },
        ],
      },
      metadata,
    );
    expect(models.map((model) => model.apiName)).toEqual(["one", "two"]);
  });

  it("rejects a payload that is not the gateway's list shape", () => {
    expect(() =>
      normalizeOpenCodeModelsPayload({ data: "nope" }, metadata),
    ).toThrow("unexpected OpenCode models payload shape");
    expect(() => normalizeOpenCodeModelsPayload(null, metadata)).toThrow();
  });
});

describe("getDiscoveredOpenCodeModels", () => {
  beforeEach(() => {
    resetOpenCodeModelDiscoveryCache();
    process.env.DYAD_OPENCODE_MODELS_URL = "http://opencode.test/v1/models";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DYAD_OPENCODE_MODELS_URL;
    resetOpenCodeModelDiscoveryCache();
  });

  function stubFetch(impl: (url: string) => Promise<unknown> | unknown) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fetches the configured list url once and caches the result", async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      json: async () => payload(["glm-5.3", "kimi-k2.6"]),
    }));

    const first = await getDiscoveredOpenCodeModels();
    const second = await getDiscoveredOpenCodeModels();

    expect(first?.map((model) => model.apiName)).toEqual([
      "glm-5.3",
      "kimi-k2.6",
    ]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://opencode.test/v1/models");
  });

  it("survives a non-OK response by keeping the last good list", async () => {
    stubFetch(() => ({ ok: true, json: async () => payload(["glm-5.3"]) }));
    const good = await getDiscoveredOpenCodeModels();
    expect(good).toHaveLength(1);

    // Force the cache to look expired, then fail the refresh.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    stubFetch(() => ({ ok: false, status: 503 }));
    const afterOutage = await getDiscoveredOpenCodeModels();
    vi.useRealTimers();

    expect(afterOutage).toEqual(good);
  });

  it("returns null when discovery has never succeeded", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    await expect(getDiscoveredOpenCodeModels()).resolves.toBeNull();
  });

  it("returns null when the gateway lists nothing usable", async () => {
    stubFetch(() => ({ ok: true, json: async () => payload([]) }));
    // An empty catalog must not be handed back as "the model list is empty",
    // which would blank the picker.
    await expect(getDiscoveredOpenCodeModels()).resolves.toBeNull();
  });
});

describe("openCodeModelsUrlForBaseUrl", () => {
  it("derives a models URL for an OpenCode base URL", () => {
    expect(openCodeModelsUrlForBaseUrl("https://opencode.ai/zen/go/v1")).toBe(
      "https://opencode.ai/zen/go/v1/models",
    );
    // A trailing slash must not produce a doubled separator.
    expect(openCodeModelsUrlForBaseUrl("https://opencode.ai/zen/go/v1/")).toBe(
      "https://opencode.ai/zen/go/v1/models",
    );
  });

  it("returns null for a non-OpenCode or missing base URL", () => {
    // A built-in provider carries no apiBaseUrl; defaulting it to the OpenCode
    // endpoint would point discovery at the wrong gateway.
    expect(openCodeModelsUrlForBaseUrl(undefined)).toBeNull();
    expect(openCodeModelsUrlForBaseUrl("")).toBeNull();
    expect(openCodeModelsUrlForBaseUrl("https://api.openai.com/v1")).toBeNull();
  });
});

describe("getDiscoveredOpenCodeModelsFor", () => {
  beforeEach(() => {
    resetOpenCodeModelDiscoveryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetOpenCodeModelDiscoveryCache();
  });

  function stubFetch(impl: (url: string) => Promise<unknown> | unknown) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fetches and caches a custom provider's own models URL", async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      json: async () => payload(["muse-spark-1.3-contributor"]),
    }));

    const url = "https://opencode.ai/zen/go/v1/models";
    const first = await getDiscoveredOpenCodeModelsFor(url);
    const second = await getDiscoveredOpenCodeModelsFor(url);

    expect(first?.map((model) => model.apiName)).toEqual([
      "muse-spark-1.3-contributor",
    ]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(url);
  });

  it("returns null for a null models URL without fetching", async () => {
    const fetchMock = stubFetch(() => {
      throw new Error("should not be called");
    });
    await expect(getDiscoveredOpenCodeModelsFor(null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys the cache by URL so two gateways do not share a list", async () => {
    const fetchMock = stubFetch((url) => ({
      ok: true,
      json: async () =>
        payload(url.endsWith("/go/v1/models") ? ["go-only"] : ["zen-only"]),
    }));

    const go = await getDiscoveredOpenCodeModelsFor(
      "https://opencode.ai/zen/go/v1/models",
    );
    const zen = await getDiscoveredOpenCodeModelsFor(
      "https://opencode.ai/zen/v1/models",
    );

    expect(go?.map((model) => model.apiName)).toEqual(["go-only"]);
    expect(zen?.map((model) => model.apiName)).toEqual(["zen-only"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
