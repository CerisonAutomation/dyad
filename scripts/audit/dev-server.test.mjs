import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { once } from "node:events";
import { createAuditServer } from "./dev-server.mjs";
import { Window } from "happy-dom";

test("audit server serves only fixed read-only routes; source paths and mutations are rejected", async () => {
  const server = createAuditServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Conversion workspace/);
    const data = await (await fetch(origin + "/api/map")).json();
    assert.ok(data.modules.length > 2000);
    assert.ok(data.toolRegistry.length > 50);
    assert.ok(
      data.toolRegistry.every((t) => t.definition),
      "All registry entries must resolve to a mapped tool definition",
    );
    assert.ok(data.entrypoints.includes("src/main_bootstrap.ts"));
    assert.ok(data.entrypoints.includes("src/renderer.tsx"));
    for (const name of ["codeSearchTool", "improvePromptTool"])
      assert.equal(
        data.toolRegistry.find((t) => t.identifier === name).definition.engine,
        "false",
      );
    for (const route of ["/.env", "/.git/config", "/src/main.ts", "/api/shell"])
      assert.equal((await fetch(origin + route)).status, 404);
    assert.equal(
      (await fetch(origin + "/api/map", { method: "POST" })).status,
      405,
    );
    assert.equal(await (await fetch(origin, { method: "HEAD" })).text(), "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("live inventory UI renders data, filters sections/scopes, and escapes source evidence", async () => {
  const window = new Window();
  window.document.write(
    await fs.readFile(new URL("./ui/index.html", import.meta.url), "utf8"),
  );
  const originalDocument = globalThis.document,
    originalFetch = globalThis.fetch;
  const fixture = {
    counts: { modules: 3, imports: 2, tools: 1, ipc: 1 },
    tools: [
      {
        identifier: "localTool",
        name: '"local"',
        file: "src/tool.ts",
        line: 1,
        scope: "runtime",
        usesEngineEndpoint: "false",
      },
    ],
    modules: [{ file: "src/tool.ts", scope: "runtime", exports: [] }],
    edges: [],
    ipc: [],
    findings: [
      {
        category: "dyadEntitlement",
        file: "src/tool.ts",
        line: 1,
        scope: "runtime",
        evidence: "<img src=x onerror=alert(1)>",
      },
      {
        category: "dyadEntitlement",
        file: "src/tool.test.ts",
        line: 2,
        scope: "test",
        evidence: "test fixture",
      },
    ],
  };
  try {
    globalThis.document = window.document;
    globalThis.fetch = async () => Response.json(fixture);
    await import(new URL("./ui/app.mjs", import.meta.url));
    const $ = (id) => window.document.getElementById(id);
    assert.match($("count").textContent, /1 matching/);
    assert.match($("results").textContent, /<img/);
    assert.equal($("results").querySelector("img"), null);
    $("scope").value = "all";
    $("scope").onchange();
    assert.match($("count").textContent, /2 matching/);
    $("search").value = "fixture";
    $("search").oninput();
    assert.match($("count").textContent, /1 matching/);
    $("search").value = "";
    $("search").oninput();
    [...$("nav").children].find((b) => b.dataset.section === "tools").click();
    assert.match($("results").textContent, /localTool/);
    [...$("nav").children].find((b) => b.dataset.section === "modules").click();
    assert.match($("results").textContent, /Inspect dependency edges/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    await window.happyDOM.close();
  }
});
