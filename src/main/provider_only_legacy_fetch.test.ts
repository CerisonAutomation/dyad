// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const base = vi.hoisted(() => vi.fn());
vi.mock("node-fetch", () => ({ default: base }));
import fetch from "./provider_only_legacy_fetch";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("blocks legacy fetch users before contacting Dyad by default", () => {
  vi.stubEnv("DYAD_ALLOW_CLOUD", undefined);
  expect(() => fetch("https://api.dyad.sh/v1/user/info")).toThrow(
    "Dyad Cloud is disabled",
  );
  expect(base).not.toHaveBeenCalled();
});
it("requires canonical API URLs rather than following unchecked redirects", async () => {
  vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
  base.mockResolvedValue({ ok: true });
  await fetch("https://api.github.com/user", { redirect: "follow" });
  expect(base).toHaveBeenCalledWith("https://api.github.com/user", {
    redirect: "error",
  });
});
it("preserves explicit manual redirects and compatibility opt-in", async () => {
  vi.stubEnv("DYAD_ALLOW_CLOUD", "false");
  base.mockResolvedValue({ ok: true });
  await fetch("https://api.github.com/user", { redirect: "manual" });
  expect(base).toHaveBeenLastCalledWith("https://api.github.com/user", {
    redirect: "manual",
  });
  vi.stubEnv("DYAD_ALLOW_CLOUD", "true");
  await fetch("https://api.dyad.sh/v1/user/info");
  expect(base).toHaveBeenLastCalledWith(
    "https://api.dyad.sh/v1/user/info",
    undefined,
  );
});
