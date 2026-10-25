import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { isDyadCloudUrl } from "@/main/dyad_cloud_policy";

export const MAX_WEB_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function isPublicWebAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    // Reject mapped, multicast, private, loopback, link-local, documentation,
    // transition and reserved ranges. In particular do not unwrap mapped IPv4.
    if (parsed.range() !== "unicast") return false;
    return parsed.kind() !== "ipv6" || parsed.match(ipaddr.parse("2000::"), 3);
  } catch { return false; }
}

export function normalizePublicWebUrl(value: string): URL {
  if (!value.trim() || value.length > 4096) throw new Error("Provide a public web URL (maximum 4096 characters)");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Only public HTTP(S) URLs without embedded credentials are allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard web ports are allowed");
  if (isDyadCloudUrl(url.href)) throw new Error("Hosted application services are not used by local web tools");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || /\.(?:localhost|local|internal|test|invalid)$/.test(host)) throw new Error("Private or reserved hosts are not allowed");
  if (isIP(host) && !isPublicWebAddress(host)) throw new Error("Private or reserved network addresses are not allowed");
  url.hash = "";
  return url;
}

type Address = { address: string; family: number };
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Resolve once and pin the validated IP into the socket's lookup callback.
 * Host header, SNI and TLS certificate validation still use the original host.
 * No browser execution, cookie jar, auth headers, proxy environment or provider key.
 */
async function fetchHop(url: URL, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses: Address[] = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicWebAddress(address))) throw new Error("Host resolves to a private or reserved network address");
  const selected = addresses[0];
  return new Promise<{ status: number; location?: string; contentType: string; body: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal, agent: false, maxHeaderSize: 16_384,
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
      headers: { Accept: "text/html, application/xhtml+xml, text/plain, text/markdown, application/json;q=0.8", "Accept-Encoding": "identity", "User-Agent": "Agent2-LocalReader/1.0" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (REDIRECTS.has(status)) {
        const location = response.headers.location;
        response.destroy(); resolve({ status, location, contentType: "", body: "" }); return;
      }
      const fail = (message: string) => { response.destroy(); reject(new Error(message)); };
      if (status < 200 || status >= 300) { fail(`Web page returned HTTP ${status}`); return; }
      const contentType = response.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? "";
      if (!/^(?:text\/(?:html|plain|markdown)|application\/(?:xhtml\+xml|json))$/.test(contentType)) { fail("Unsupported page type; use a document or browser tool for binary/JavaScript-only content"); return; }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { fail("Compressed page response is unsupported by the bounded local reader"); return; }
      if (Number(response.headers["content-length"]) > MAX_WEB_BYTES) { fail("Web page exceeds the 2 MiB reader budget"); return; }
      let bytes = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_WEB_BYTES) { fail("Web page exceeds the 2 MiB reader budget"); return; }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("aborted", () => reject(new Error("Web page response was interrupted")));
      response.once("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end();
  });
}

export function extractReadableWebText(html: string): string {
  const tree = parse(html);
  const text: string[] = [];
  const skip = new Set(["script", "style", "template", "noscript", "iframe", "svg"]);
  const blocks = new Set(["p", "div", "section", "article", "main", "header", "footer", "li", "h1", "h2", "h3", "h4", "pre", "br", "tr"]);
  // Iterative traversal avoids stack overflow on deeply nested hostile HTML.
  const stack: DefaultTreeAdapterMap["node"][] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    if ("tagName" in node && (skip.has(node.tagName) || node.attrs.some((a) => a.name === "hidden" || (a.name === "aria-hidden" && a.value === "true")))) continue;
    if (node.nodeName === "#text" && "value" in node) text.push(node.value);
    if ("tagName" in node && blocks.has(node.tagName)) text.push("\n");
    if ("childNodes" in node) for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push(node.childNodes[index]);
  }
  return text.join(" ").replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function readPublicWebPage(value: string, signal?: AbortSignal) {
  const deadline = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  let url = normalizePublicWebUrl(value);
  for (let hop = 0; hop <= 5; hop++) {
    deadline.throwIfAborted();
    const response = await fetchHop(url, deadline);
    if (REDIRECTS.has(response.status)) {
      if (!response.location || hop === 5) throw new Error("Missing redirect location or redirect limit exceeded");
      const next = normalizePublicWebUrl(new URL(response.location, url).href);
      if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("HTTPS downgrade redirects are not allowed");
      url = next; continue;
    }
    const readable = response.contentType.includes("html") ? extractReadableWebText(response.body) : response.body;
    return { url: url.href, text: readable.slice(0, MAX_TEXT_CHARS), truncated: readable.length > MAX_TEXT_CHARS, screenshotAvailable: false as const };
  }
  throw new Error("Redirect limit exceeded");
}
