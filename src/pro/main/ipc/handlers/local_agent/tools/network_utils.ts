/**
 * Network safety utilities for SSRF prevention.
 *
 * Provides `assertNotPrivateIp` which throws a `DyadError` when a URL targets
 * a loopback, link-local, private, or otherwise restricted address.
 */

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * Parse a numeric IPv4 address string (e.g. "10.0.1.5") into four octets.
 * Returns `undefined` when the input is not a valid dotted-decimal IPv4 address.
 */
function parseIpv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return undefined;
  return [octets[0], octets[1], octets[2], octets[3]];
}

/**
 * Expand a compressed IPv6 address to its full 8-group hex form (32 hex chars)
 * using the `::` compression indicator.  Returns `undefined` when the input is
 * not a valid IPv6 address.
 *
 * Handles the dotted IPv4-mapped notation (e.g. `::ffff:127.0.0.1`) by
 * converting the trailing IPv4 octets to hex groups first.
 */
function expandIpv6(host: string): string | undefined {
  // Strip any zone-id suffix (e.g. "%eth0")
  const cleaned = host.includes("%") ? host.slice(0, host.indexOf("%")) : host;

  // Handle dotted IPv4-mapped notation: ::ffff:x.x.x.x
  // Convert the trailing IPv4 portion to 2 hex groups before expansion.
  const dottedMatch = cleaned.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  let work = cleaned;
  if (dottedMatch) {
    const prefix = dottedMatch[1]; // everything before the IPv4 part
    const ipv4 = dottedMatch[2];
    const octets = ipv4.split(".").map(Number);
    if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return undefined;
    const g1 = ((octets[0] << 8) | octets[1]).toString(16);
    const g2 = ((octets[2] << 8) | octets[3]).toString(16);
    work = prefix + g1 + ":" + g2;
  }

  // Only hex digits, colons, and double-colon allowed after dotted expansion
  if (!/^[0-9a-fA-F:]+$/.test(work)) return undefined;

  const parts = work.split("::");

  if (parts.length > 2) return undefined; // more than one ::

  const left =
    parts[0] === "" ? [] : parts[0].split(":").filter((s) => s !== "");
  const right =
    parts.length === 2
      ? parts[1] === ""
        ? []
        : parts[1].split(":").filter((s) => s !== "")
      : [];

  if (left.length + right.length > 8) return undefined;

  const gap = 8 - left.length - right.length;
  if (gap < 0) return undefined;

  // Zero-pad each group to 4 hex chars and join into a 32-char string
  const groups = [...left, ...Array(gap).fill("0"), ...right];
  return groups.map((g) => g.padStart(4, "0")).join("");
}

/**
 * Returns `true` when the given hostname resolves to a private / restricted
 * IP range that must not be fetched to prevent SSRF.
 *
 * Blocks:
 *  - localhost, 0.0.0.0
 *  - IPv6 loopback (::1, ::ffff:127.0.0.1)
 *  - IPv4 loopback (127.0.0.0/8)
 *  - RFC 1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *  - Link-local (169.254.0.0/16)
 *  - IPv6 link-local (fe80::/10)
 *  - IPv6 private ranges (fc00::/7, fec0::/10)
 *  - IPv4-mapped IPv6 (::ffff:0:0/96) carrying any of the above
 */
export function isPrivateIp(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  // Well-known names
  if (host === "localhost" || host === "0.0.0.0" || host === "") return true;

  // IPv4 (may also be embedded in brackets in IPv6-mapped form)
  const v4 = parseIpv4(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }

  // IPv6 – expand to 32-char hex for range checks
  const hex = expandIpv6(host);
  if (!hex) return false;

  // ::1 — loopback
  if (hex === "00000000000000000000000000000001") return true;

  // fc00::/7 — IPv6 unique-local
  if (hex.startsWith("fc") || hex.startsWith("fd")) return true;

  // fe80::/10 — link-local
  if (hex.startsWith("fe80")) return true;

  // fec0::/10 — deprecated site-local, block for SSRF defense-in-depth
  if (hex.startsWith("fec0")) return true;

  // Check embedded IPv4-mapped / IPv4-compatible addresses (::ffff:x.x.x.x or ::x.x.x.x)
  // The last 8 hex chars encode two 16-bit groups = 4 IPv4 octets.
  if (
    hex.startsWith("00000000000000000000ffff") ||
    hex.startsWith("000000000000000000000000")
  ) {
    const embedded = `${parseInt(hex.slice(24, 26), 16)}.${parseInt(hex.slice(26, 28), 16)}.${parseInt(hex.slice(28, 30), 16)}.${parseInt(hex.slice(30, 32), 16)}`;
    return isPrivateIp(embedded);
  }

  return false;
}

/**
 * Validate a URL is not targeting a private / restricted IP range.
 * Throws a `DyadError` (Validation kind) when the address is blocked.
 *
 * Call this **before** performing the actual fetch.
 */
export function assertNotPrivateIp(
  url: string,
  options?: { allowLocalhost?: boolean },
): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new DyadError(`Invalid URL: ${url}`, DyadErrorKind.Validation);
  }

  // Allow localhost for local model services (Ollama, LMStudio) when explicitly permitted
  if (
    options?.allowLocalhost &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
  ) {
    return;
  }

  if (isPrivateIp(hostname)) {
    throw new DyadError(
      `Fetching private/internal addresses is not allowed: ${hostname}`,
      DyadErrorKind.Validation,
    );
  }
}
