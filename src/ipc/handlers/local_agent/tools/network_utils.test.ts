import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";

const dnsMock = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => {
  const mocked = { lookup: dnsMock.lookup };
  return { ...mocked, default: mocked };
});

import { assertNotPrivateIpResolved, isPrivateIp } from "./network_utils";

/**
 * Regression coverage for the SSRF guard. Every case here is a bypass that was
 * live in this file before the fix, or a range that was simply missing.
 */
describe("isPrivateIp", () => {
  describe("IPv4 private and reserved ranges", () => {
    it.each([
      "0.0.0.0", // 0.0.0.0/8
      "10.0.0.1", // RFC1918
      "127.0.0.1", // loopback
      "169.254.169.254", // link-local / cloud metadata
      "172.16.0.1", // RFC1918 lower bound
      "172.31.255.254", // RFC1918 upper bound
      "192.168.1.1", // RFC1918
      "100.64.0.1", // RFC6598 CGNAT (Tailscale, k8s pods)
      "100.127.255.255", // RFC6598 upper bound
      "198.18.0.1", // RFC2544 benchmarking
      "192.0.0.1", // IETF protocol assignments
      "224.0.0.1", // multicast
      "255.255.255.255", // broadcast
    ])("blocks %s", (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  });

  describe("IPv6 literals, including the bracketed URL form", () => {
    it.each([
      "[::1]", // loopback
      "::1",
      "[::ffff:127.0.0.1]", // IPv4-mapped loopback
      "[::ffff:10.0.0.1]", // IPv4-mapped RFC1918
      "[::ffff:169.254.169.254]", // IPv4-mapped metadata endpoint
      "[fe80::1]", // link-local
      "[fea0::1]", // link-local, outside the fe80::/32 that used to be tested
      "[febf::1]", // link-local upper bound of fe80::/10
      "[fec0::1]", // site-local, outside the fec0::/32 that used to be tested
      "[fc00::1]", // unique-local fc00::/7
      "[fd00::1]", // unique-local fd00::/7
    ])("blocks %s", (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  });

  describe("hostnames", () => {
    it.each(["localhost", "LOCALHOST", "  localhost  "])(
      "blocks %s",
      (host) => {
        expect(isPrivateIp(host)).toBe(true);
      },
    );

    it.each(["LOCALHOST.evil.example", "not-localhost"])(
      "does not treat %s as loopback",
      (host) => {
        expect(isPrivateIp(host)).toBe(false);
      },
    );
  });

  describe("public addresses are still allowed", () => {
    it.each([
      "1.1.1.1",
      "8.8.8.8",
      "93.184.216.34",
      "172.32.0.1", // just above RFC1918
      "172.15.255.255", // just below RFC1918
      "100.63.255.255", // just below CGNAT
      "100.128.0.1", // just above CGNAT
      "[2606:4700:4700::1111]", // public IPv6
      "example.com",
    ])("allows %s", (host) => {
      expect(isPrivateIp(host)).toBe(false);
    });
  });

  it("does not throw on malformed input", () => {
    for (const junk of [
      "",
      " ",
      "not-an-ip",
      "999.999.999.999",
      "::gg",
      "[",
      "]",
    ]) {
      expect(() => isPrivateIp(junk)).not.toThrow();
    }
  });
});

/**
 * The literal check alone is bypassable: a name such as `127.0.0.1.nip.io` or
 * a rebinding A record resolves to a private address without looking like
 * one, so the resolved addresses have to be validated too.
 */
describe("assertNotPrivateIpResolved", () => {
  beforeEach(() => {
    dnsMock.lookup.mockReset();
  });

  it("rejects a hostname that resolves to loopback", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    await expect(
      assertNotPrivateIpResolved("http://127.0.0.1.nip.io/"),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
  });

  it("rejects when any of the resolved addresses is private", async () => {
    dnsMock.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(
      assertNotPrivateIpResolved("https://rebind.example/"),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
  });

  it("rejects a hostname that resolves to an IPv6 loopback", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "::1", family: 6 }]);

    await expect(
      assertNotPrivateIpResolved("https://ipv6-loopback.example/"),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
  });

  it("allows a hostname that only resolves to public addresses", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await expect(
      assertNotPrivateIpResolved("https://example.com/"),
    ).resolves.toBeUndefined();
  });

  it("does not resolve an address literal", async () => {
    await expect(
      assertNotPrivateIpResolved("https://1.1.1.1/"),
    ).resolves.toBeUndefined();
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("rejects a literal private address without resolving it", async () => {
    await expect(
      assertNotPrivateIpResolved("http://127.0.0.1/"),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });
});
