import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Real Chromium + the production driver/DOM collector. Only the app URL lookup
// and Electron logger are replaced, avoiding a fake Electron/database backend.
// This fixture is not an Electron end-to-end or live-provider certification.
const require = createRequire(import.meta.url);
const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(`<!doctype html><html><head><title>Preview QA</title></head><body>
    <h1>Fixture app</h1><button id="counter" onclick="this.textContent='Count '+(++window.count)">Count 0</button>
    <label for="name">Name</label><input id="name" value="private-field-value">
    <button class="duplicate">First</button><button class="duplicate">Second</button>
    <a id="external" href="https://evil.test/">External destination</a>
    <script>window.count=0; console.log('fixture-ready');</script>
    </body></html>`);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(resolve("node_modules/.preview-driver-smoke-"));
let driver;
try {
  const output = resolve(directory, "driver.mjs");
  await build({
    entryPoints: ["src/ipc/utils/preview_browser_driver.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "fixture-preview-host",
        setup(build) {
          build.onResolve(
            { filter: /^@\/ipc\/handlers\/tests_handlers$/ },
            () => ({ path: "host", namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export function getRunningTestBaseUrl() { return ${JSON.stringify(origin)}; }`,
          }));
          build.onResolve({ filter: /^electron-log$/ }, () => ({
            path: require.resolve("electron-log/node"),
            external: true,
          }));
        },
      },
    ],
  });
  driver = await import(pathToFileURL(output).href);
  assert.match(await driver.previewRead(1), /Fixture app/);
  const snapshot = JSON.parse(await driver.previewDom(1));
  assert(snapshot.elements.some((element) => element.selector === "#counter"));
  assert(!JSON.stringify(snapshot).includes("private-field-value"));
  await driver.previewClick(1, "#counter");
  assert.match(await driver.previewRead(1), /Count 1/);
  await driver.previewType(1, "#name", "filled by real browser QA", false);
  await assert.rejects(driver.previewClick(1, ".duplicate"), /exactly one/);
  assert.match(await driver.previewRead(1), /Count 1/);
  assert.match(await driver.previewViewport(1, 390, 844), /390x844/);
  const image = await driver.previewScreenshot(1);
  assert(image.startsWith("data:image/jpeg;base64,"));
  assert.equal(
    Buffer.from(image.split(",")[1], "base64").subarray(0, 3).toString("hex"),
    "ffd8ff",
  );
  assert.match(await driver.previewConsole(1), /fixture-ready/);
  await assert.rejects(
    driver.previewNavigate(1, "https://evil.test/"),
    /Preview navigation/,
  );
  await driver.previewClick(1, "#external").catch((error) => {
    // Playwright may report the deliberately aborted navigation as a click error.
    assert.match(error.message, /ERR_FAILED|aborted|interrupted/);
  });
  assert.match(await driver.previewConsole(1), /navigation-blocked/);
  await driver.previewNavigate(1, "/settings");
  assert.match(await driver.previewRead(1), /Fixture app/);
  await driver.closePreviewBrowserSession(1);
  assert.match(await driver.previewRead(1), /Count 0/);
  console.log(
    "PASS real Chromium: initial render, bounded DOM, precise click, fill, ambiguous-selector rejection, responsive viewport, real JPEG, console, external-navigation denial, route navigation and fresh-session cleanup.",
  );
} finally {
  await driver?.closeAllPreviewBrowserSessions();
  server.close();
  await once(server, "close");
  await rm(directory, { recursive: true, force: true });
}
