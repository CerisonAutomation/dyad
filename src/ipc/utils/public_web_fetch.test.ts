import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  isPublicWebAddress,
  normalizePublicWebUrl,
  extractReadableWebText,
  readPublicWebPage,
} from "./public_web_fetch";
const mocks = vi.hoisted(() => ({ dns: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  lookup: mocks.dns,
  default: { lookup: mocks.dns },
}));
vi.mock("node:http", () => ({
  request: mocks.request,
  default: { request: mocks.request },
}));
vi.mock("node:https", () => ({
  request: mocks.request,
  default: { request: mocks.request },
}));
beforeEach(() => {
  mocks.dns.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.request.mockReset();
});
function respond(
  body: string,
  headers = { "content-type": "text/html" },
  status = 200,
) {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      options.lookup(
        "public.example",
        { all: true },
        (_err: unknown, addresses: unknown) =>
          expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]),
      );
      const response = Readable.from([Buffer.from(body)]) as Readable & {
        statusCode: number;
        headers: typeof headers;
      };
      response.statusCode = status;
      response.headers = headers;
      callback(response);
    };
    return request;
  });
}
it.each([
  "127.0.0.1",
  "10.1.2.3",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "0.0.0.0",
  "100.64.0.1",
  "224.0.0.1",
  "::1",
  "fe80::1",
  "fc00::1",
  "::ffff:8.8.8.8",
  "2001:db8::1",
  "2002:808:808::",
])("rejects non-public IP %s", (ip) => {
  expect(isPublicWebAddress(ip)).toBe(false);
});
it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
  "accepts public address %s",
  (ip) => expect(isPublicWebAddress(ip)).toBe(true),
);
it.each([
  "file:///etc/passwd",
  "ftp://example.com",
  "http://user:pass@example.com",
  "http://2130706433",
  "http://0x7f000001",
  "http://localhost",
  "https://host.local",
  "https://api.dyad.sh/v1",
  "https://example.com:8443",
])("rejects unsafe URL %s before networking", async (url) => {
  await expect(readPublicWebPage(url)).rejects.toThrow();
  expect(mocks.dns).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("normalizes bare domains and strips fragments", () =>
  expect(normalizePublicWebUrl("example.com/docs#one").href).toBe(
    "https://example.com/docs",
  ));
it("blocks DNS rebinding by pinning the validated public answer", async () => {
  respond("<h1>Public docs</h1><p>Hello</p>");
  const result = await readPublicWebPage("https://public.example");
  expect(result.text).toContain("Public docs");
  expect(result.screenshotAvailable).toBe(false);
  expect(mocks.dns).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(mocks.request.mock.calls[0][1].agent).toBe(false);
});
it("rejects mixed public/private DNS answers without opening a socket", async () => {
  mocks.dns.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow(
    /private/,
  );
  expect(mocks.request).not.toHaveBeenCalled();
});
it("checks redirect destinations before opening another socket", async () => {
  respond(
    "",
    {
      "content-type": "text/html",
      location: "http://169.254.169.254/metadata",
    } as any,
    302,
  );
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("rejects TLS downgrade redirects", async () => {
  respond(
    "",
    {
      "content-type": "text/html",
      location: "http://public.example/next",
    } as any,
    302,
  );
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow(
    /downgrade/,
  );
});
it("rejects declared and streamed oversized bodies", async () => {
  respond("body", {
    "content-type": "text/html",
    "content-length": "3000000",
  } as any);
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow(
    /budget/,
  );
  respond("x".repeat(2 * 1024 * 1024 + 1));
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow(
    /budget/,
  );
});
it("rejects compressed and binary content rather than parsing it", async () => {
  respond("gzip", {
    "content-type": "text/html",
    "content-encoding": "gzip",
  } as any);
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow(
    /Compressed/,
  );
  respond("binary", { "content-type": "application/pdf" });
  await expect(readPublicWebPage("https://public.example")).rejects.toThrow(
    /Unsupported/,
  );
});
it("does not execute scripts or retain hidden/script/style text", () =>
  expect(
    extractReadableWebText(
      '<h1>Docs &amp; examples</h1><script>steal()</script><style>hidden</style><p hidden>secret</p><p aria-hidden="true">private</p><p>Safe</p>',
    ),
  ).toBe("Docs & examples\nSafe"));
it("supports cancellation before DNS or sockets", async () => {
  const signal = AbortSignal.abort();
  await expect(
    readPublicWebPage("https://public.example", signal),
  ).rejects.toThrow();
  expect(mocks.dns).not.toHaveBeenCalled();
});
