// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT = join(__dirname, "..", "..", "worker", "dyad-component-selector-client.js");

function loadClient(): { posted: Array<{ type: string }> } {
  document.body.innerHTML = `
    <div id="root">
      <header class="hdr">Title</header>
      <main><p>body text</p></main>
    </div>`;
  // happy-dom reports zero-sized rects; give everything a box so the runtime
  // tagger's area filter sees real elements.
  for (const el of Array.from(document.querySelectorAll("*"))) {
    el.getBoundingClientRect = () =>
      ({ width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40 }) as DOMRect;
  }
  const posted: Array<{ type: string }> = [];
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: { postMessage: (m: { type: string }) => posted.push(m) },
  });
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(CLIENT, "utf8"))();
  return { posted };
}

const RUNTIME_PREFIX = "__dyad_rt__:";

describe("component selector client", () => {
  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("initializes with runtime ids when the app has no build-time tags", async () => {
    // Regression: the feature used to wait the full 60s and then disable itself,
    // so it never worked in an app built by anything other than the Vite tagger.
    // FYKZ1 is Next.js, so that was the only path it ever took.
    const { posted } = loadClient();
    expect(posted).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 2200));

    expect(
      posted.some((m) => m.type === "dyad-component-selector-initialized"),
    ).toBe(true);

    const tagged = document.querySelectorAll("[data-dyad-id]");
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged[0].getAttribute("data-dyad-id")).toMatch(
      new RegExp(`^${RUNTIME_PREFIX}`),
    );
    expect(tagged[0].getAttribute("data-dyad-name")).toBeTruthy();
  });

  test("prefers real build-time tags over runtime ones", async () => {
    // A Vite app tags at build time. It must not be overwritten, and the ids
    // must keep their file path so the selector can still open the source.
    const { posted } = loadClient();
    const pre = document.querySelector("main")!;
    pre.setAttribute("data-dyad-id", "src/App.tsx:Album:42");
    pre.setAttribute("data-dyad-name", "Album");

    await new Promise((r) => setTimeout(r, 2200));

    expect(
      posted.some((m) => m.type === "dyad-component-selector-initialized"),
    ).toBe(true);
    expect(pre.getAttribute("data-dyad-id")).toBe("src/App.tsx:Album:42");
    // No synthesised ids leaked onto other elements.
    const runtime = Array.from(document.querySelectorAll("[data-dyad-id]")).filter(
      (el) => el.getAttribute("data-dyad-id")!.startsWith(RUNTIME_PREFIX),
    );
    expect(runtime).toHaveLength(0);
  });
});
