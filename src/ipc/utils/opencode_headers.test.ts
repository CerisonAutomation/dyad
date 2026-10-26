import { expect, it, vi } from "vitest";
import { getOpenCodeHeaders, withOpenCodeHeaders } from "./opencode_headers";
it("keeps one conversation stable across client recreation and separates chats/installations", () => {
  const url = "https://opencode.ai/zen/go/v1";
  const first = getOpenCodeHeaders(url, "installation-a", 12)!;
  expect(first).toEqual(getOpenCodeHeaders(url, "installation-a", 12));
  expect(first["x-opencode-session"]).not.toBe(
    getOpenCodeHeaders(url, "installation-a", 13)!["x-opencode-session"],
  );
  expect(first["x-opencode-session"]).not.toBe(
    getOpenCodeHeaders(url, "installation-b", 12)!["x-opencode-session"],
  );
  expect(first["x-opencode-session"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(JSON.stringify(first)).not.toContain("installation-a");
  expect(first["User-Agent"]).toBe("Agent2");
});
it.each(["https://opencode.ai/zen/go/v1/", "https://opencode.ai/zen/v1"])(
  "supports the official endpoint %s",
  (url) => {
    expect(
      getOpenCodeHeaders(url, "installation", 1)?.["x-opencode-session"],
    ).toBeTruthy();
  },
);
it.each([
  "https://evil.test/zen/go/v1",
  "https://opencode.ai.evil.test/zen/go/v1",
  "https://opencode.ai@evil.test/zen/go/v1",
  "https://user:pass@opencode.ai/zen/go/v1",
  "http://opencode.ai/zen/go/v1",
  "https://opencode.ai:8443/zen/go/v1",
  "https://opencode.ai/other",
  "not a URL",
])("never sends routing identity to %s", (url) => {
  expect(getOpenCodeHeaders(url, "installation", 1)).toBeUndefined();
});
it("gives detached operations independent sessions rather than a global fixed ID", () => {
  const url = "https://opencode.ai/zen/go/v1";
  expect(
    getOpenCodeHeaders(url, "installation")!["x-opencode-session"],
  ).not.toBe(getOpenCodeHeaders(url, "installation")!["x-opencode-session"]);
});
it("supports a stable named help session", () => {
  const url = "https://opencode.ai/zen/go/v1";
  expect(getOpenCodeHeaders(url, "installation", "help:abc")).toEqual(
    getOpenCodeHeaders(url, "installation", "help:abc"),
  );
  expect(getOpenCodeHeaders(url, "installation", "help:abc")).not.toEqual(
    getOpenCodeHeaders(url, "installation", "help:def"),
  );
});

it("enforces destination scoping and disables automatic redirect forwarding", async () => {
  const send = vi.fn(async () => new Response("OK"));
  const required = getOpenCodeHeaders(
    "https://opencode.ai/zen/go/v1",
    "install",
    1,
  )!;
  const request = withOpenCodeHeaders(send, required);
  const signal = new AbortController().signal;
  await request("https://opencode.ai/zen/go/v1/chat/completions", {
    method: "POST",
    body: "{}",
    signal,
    headers: {
      authorization: "Bearer test",
      "user-agent": "Agent2 sdk",
      "x-opencode-session": "incorrect-override",
    },
  });
  const init = (send.mock.calls[0] as unknown as [unknown, RequestInit])[1];
  expect(init.redirect).toBe("error");
  expect(init.signal).toBe(signal);
  expect(init.body).toBe("{}");
  const headers = new Headers(init.headers);
  expect(headers.get("x-opencode-session")).toBe(
    required["x-opencode-session"],
  );
  expect(headers.get("authorization")).toBe("Bearer test");
  expect(headers.get("user-agent")).toBe("Agent2 sdk");
  await expect(request("https://evil.test/chat/completions")).rejects.toThrow(
    "unexpected inference destination",
  );
  await expect(request("https://opencode.ai/unrelated")).rejects.toThrow(
    "unexpected inference destination",
  );
  expect(send).toHaveBeenCalledTimes(1);
});
