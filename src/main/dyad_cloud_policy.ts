/** Provider-only builds deny Dyad-operated HTTP endpoints by default.
 * This is an application guard, not an OS firewall for subprocesses or MCPs.
 */
export function isDyadCloudUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    return (
      host === "dyad.sh" ||
      host.endsWith(".dyad.sh") ||
      host === "dyad-image-uploader-git-697714312563.us-west1.run.app" ||
      host === "dyad-llm-engine-kq7pivehnq-uc.a.run.app" ||
      host === "staging---dyad-llm-engine-kq7pivehnq-uc.a.run.app"
    );
  } catch {
    return false;
  }
}

export function isDyadCloudAllowed(): boolean {
  // Explicit compatibility escape hatch. Never enabled by a saved Pro key.
  return process.env.DYAD_ALLOW_CLOUD === "true";
}

export function assertDyadCloudAllowed(url: string): void {
  if (!isDyadCloudAllowed() && isDyadCloudUrl(url)) {
    throw new Error(
      "Dyad Cloud is disabled in provider-only mode. Configure a direct provider or local tool instead.",
    );
  }
}

/** Check EVERY redirect hop before sending it, including cross-origin hops.
 * Keep Node's fetch signature so SDKs can use this without provider changes.
 */
export function createProviderOnlyFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (isDyadCloudAllowed()) return baseFetch(input, init);
    let request = new Request(input, init);
    for (let hop = 0; ; hop++) {
      assertDyadCloudAllowed(request.url);
      const response = await baseFetch(request.clone(), { redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location || request.redirect === "manual") return response;
      // Release redirect bodies before following or throwing.
      void response.body?.cancel().catch(() => {});
      if (request.redirect === "error")
        throw new TypeError("Fetch redirect is not allowed");
      if (hop >= 20) throw new TypeError("Too many fetch redirects");
      const target = new URL(location, request.url);
      assertDyadCloudAllowed(target.href);
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.username ||
        target.password
      ) {
        throw new TypeError("Unsupported fetch redirect URL");
      }
      const headers = new Headers(request.headers);
      if (target.origin !== new URL(request.url).origin) {
        for (const name of [
          "authorization",
          "proxy-authorization",
          "cookie",
          "x-api-key",
        ])
          headers.delete(name);
      }
      const switchToGet =
        ((response.status === 301 || response.status === 302) &&
          request.method === "POST") ||
        (response.status === 303 && !["GET", "HEAD"].includes(request.method));
      if (switchToGet) {
        for (const name of [
          "content-type",
          "content-length",
          "content-encoding",
          "content-language",
          "content-location",
        ])
          headers.delete(name);
      }
      request = new Request(target, {
        method: switchToGet ? "GET" : request.method,
        headers,
        body: switchToGet ? undefined : request.body,
        signal: request.signal,
        redirect: request.redirect,
        credentials: request.credentials,
        ...(request.body && !switchToGet ? { duplex: "half" } : {}),
      });
    }
  };
}

let installed = false;
export function installProviderOnlyFetch(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = createProviderOnlyFetch(globalThis.fetch.bind(globalThis));
}
