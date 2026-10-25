import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ["/", [path.join(here, "ui/index.html"), "text/html; charset=utf-8"]],
  [
    "/app.js",
    [path.join(here, "ui/app.mjs"), "text/javascript; charset=utf-8"],
  ],
  [
    "/api/map",
    [
      path.resolve(here, "../../docs/generated/app-map.json"),
      "application/json; charset=utf-8",
    ],
  ],
]);
export function createAuditServer() {
  return http.createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const route = routes.get(new URL(req.url, "http://audit.local").pathname);
    if (!route) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const body = await fs.readFile(route[0]);
      res.writeHead(200, {
        "Content-Type": route[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors *",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(503);
      res.end("Generate the app map with npm run audit:app first.");
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 5173);
  createAuditServer().listen(port, "0.0.0.0", () =>
    console.log(`Agent2 conversion workspace listening on 0.0.0.0:${port}`),
  );
}
