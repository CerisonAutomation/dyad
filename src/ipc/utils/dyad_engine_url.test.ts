import { afterEach, describe, expect, it, vi } from "vitest";

import { getDyadEngineBaseUrl } from "./dyad_engine_url";
import { getLmStudioBaseUrl } from "./lm_studio_utils";

const originalDyadEngineUrl = process.env.DYAD_ENGINE_URL;
const originalLmStudioUrl = process.env.LM_STUDIO_BASE_URL_FOR_TESTING;

describe("call-time model service URLs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalDyadEngineUrl === undefined) {
      delete process.env.DYAD_ENGINE_URL;
    } else {
      process.env.DYAD_ENGINE_URL = originalDyadEngineUrl;
    }
    if (originalLmStudioUrl === undefined) {
      delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
    } else {
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING = originalLmStudioUrl;
    }
  });

  it("reads DYAD_ENGINE_URL when called after explicit legacy opt-in", () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "true");
    delete process.env.DYAD_ENGINE_URL;
    expect(getDyadEngineBaseUrl()).toBe("https://engine.dyad.sh/v1");

    process.env.DYAD_ENGINE_URL = "http://127.0.0.1:4321/v1";
    expect(getDyadEngineBaseUrl()).toBe("http://127.0.0.1:4321/v1");
  });

  it("reads LM_STUDIO_BASE_URL_FOR_TESTING when called", () => {
    delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
    expect(getLmStudioBaseUrl()).toBe("http://localhost:1234");

    process.env.LM_STUDIO_BASE_URL_FOR_TESTING = "http://127.0.0.1:9876";
    expect(getLmStudioBaseUrl()).toBe("http://127.0.0.1:9876");
  });
});

it("blocks the default cloud engine but permits an explicitly configured local engine", () => {
  vi.stubEnv("DYAD_ALLOW_CLOUD", undefined);
  vi.stubEnv("DYAD_ENGINE_URL", undefined);
  try {
    expect(() => getDyadEngineBaseUrl()).toThrow("Dyad Cloud is disabled");
    vi.stubEnv("DYAD_ENGINE_URL", "http://localhost:8080/v1");
    expect(getDyadEngineBaseUrl()).toBe("http://localhost:8080/v1");
  } finally {
    vi.unstubAllEnvs();
  }
});
