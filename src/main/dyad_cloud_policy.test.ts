// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderOnlyFetch, isDyadCloudUrl } from "./dyad_cloud_policy";
afterEach(() => vi.unstubAllEnvs());

describe("provider-only network policy", () => {
  it.each([
    "https://dyad.sh",
    "https://engine.dyad.sh/v1",
    "https://API.DYAD.SH./v1",
    "https://supabase-oauth.dyad.sh/refresh",
    "https://dyad-llm-engine-kq7pivehnq-uc.a.run.app/v1",
  ])("recognizes %s", (url) => expect(isDyadCloudUrl(url)).toBe(true));
  it.each([
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "http://localhost:8000/v1",
    "https://dyad.sh.attacker.example",
    "https://github.com/dyad-sh/dyad",
  ])("does not confuse %s with a Dyad service", (url) =>
    expect(isDyadCloudUrl(url)).toBe(false),
  );
  it("blocks before network access, without exposing the URL secret", async () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
    const base = vi.fn();
    await expect(
      createProviderOnlyFetch(base)("https://api.dyad.sh/?token=secret"),
    ).rejects.toThrow("Dyad Cloud is disabled");
    expect(base).not.toHaveBeenCalled();
  });
  it("blocks redirects from an otherwise permitted provider", async () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
    const base = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://engine.dyad.sh/v1" },
      }),
    );
    await expect(
      createProviderOnlyFetch(base)("https://gateway.example"),
    ).rejects.toThrow("Dyad Cloud is disabled");
    expect(base).toHaveBeenCalledTimes(1);
  });
  it("follows allowed redirects but strips credentials on an origin change", async () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
    const base = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/file" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    const result = await createProviderOnlyFetch(base)(
      "https://gateway.example",
      {
        method: "POST",
        body: "input",
        headers: {
          Authorization: "secret",
          "x-api-key": "secret",
          "Content-Type": "application/json",
        },
      },
    );
    expect(await result.text()).toBe("ok");
    const redirected = base.mock.calls[1][0] as Request;
    expect(redirected.method).toBe("GET");
    expect(redirected.headers.has("authorization")).toBe(false);
    expect(redirected.headers.has("x-api-key")).toBe(false);
    expect(redirected.headers.has("content-type")).toBe(false);
  });
  it("preserves request bodies on 307 redirects", async () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
    const base = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location: "/next" } }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    await createProviderOnlyFetch(base)("https://gateway.example", {
      method: "POST",
      body: "input",
    });
    expect(await (base.mock.calls[1][0] as Request).text()).toBe("input");
  });
  it("honors manual and error redirect policies", async () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
    const base = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "/next" } }),
      ),
    );
    expect(
      (
        await createProviderOnlyFetch(base)("https://gateway.example", {
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    await expect(
      createProviderOnlyFetch(base)("https://gateway.example", {
        redirect: "error",
      }),
    ).rejects.toThrow("redirect is not allowed");
  });
  it("permits legacy cloud only via the explicit process opt-in", async () => {
    vi.stubEnv("DYAD_ALLOW_CLOUD", "true");
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    await createProviderOnlyFetch(base)("https://api.dyad.sh");
    expect(base).toHaveBeenCalledTimes(1);
  });
});
