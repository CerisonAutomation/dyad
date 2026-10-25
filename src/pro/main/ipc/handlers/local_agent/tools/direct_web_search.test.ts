import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
vi.mock("@/ipc/utils/read_env", () => ({ getEnvVar: () => undefined }));
import { directWebSearch, getDirectSearchConfig } from "./direct_web_search";

const config = {
  provider: "openai",
  apiKey: "secret",
  model: "configured-model",
};
afterEach(() => vi.unstubAllGlobals());

describe("direct web search", () => {
  it("uses the selected model and key only in explicit API-key mode", () => {
    const settings = {
      selectedModel: { provider: "openai", name: config.model },
      providerSettings: { openai: { apiKey: { value: " secret " } } },
      proModelUsage: "api-key",
    } as unknown as UserSettings;
    expect(getDirectSearchConfig(settings)).toEqual(config);
    expect(
      getDirectSearchConfig({ ...settings, proModelUsage: "subscription" }),
    ).toBeUndefined();
    expect(
      getDirectSearchConfig({ ...settings, proModelUsage: "pro" }),
    ).toBeUndefined();
  });

  it("sends an OpenAI search request and preserves source URLs", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: "Answer",
                  annotations: [
                    { type: "url_citation", url: "https://example.com" },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await directWebSearch("question", config)).toBe(
      "Answer\n\nSources:\nhttps://example.com",
    );
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(request.body)).toMatchObject({
      model: config.model,
      tool_choice: "required",
    });
    expect(request.headers.Authorization).toBe("Bearer secret");
  });

  it("extracts Anthropic text and citations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: "Answer",
                citations: [{ url: "https://example.com" }],
              },
            ],
          }),
        ),
      ),
    );
    expect(
      await directWebSearch("question", { ...config, provider: "anthropic" }),
    ).toContain("https://example.com");
  });

  it("surfaces Anthropic tool errors instead of treating them as results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "web_search_tool_result",
                content: {
                  type: "web_search_tool_result_error",
                  error_code: "max_uses_exceeded",
                },
              },
            ],
          }),
        ),
      ),
    );
    await expect(
      directWebSearch("q", { ...config, provider: "anthropic" }),
    ).rejects.toThrow("tool error");
  });

  it("does not retry with a different billing source or expose response secrets", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("secret", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    await expect(directWebSearch("q", config)).rejects.toThrow("HTTP 429");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects empty provider results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"output":[]}')),
    );
    await expect(directWebSearch("q", config)).rejects.toThrow(
      "no text results",
    );
  });
});
