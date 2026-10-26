import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { collectPreviewDom } from "./preview_dom";
beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return {
        x: 0,
        y: 0,
        width: this.hasAttribute("hidden") ? 0 : 100,
        height: 30,
        top: 0,
        left: 0,
        bottom: 30,
        right: 100,
        toJSON: () => ({}),
      };
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
it("supplies precise selectors, accessible labels and bounds without field values", () => {
  document.body.innerHTML =
    '<label for="name">Display name</label><input id="name" value="private-value"><input id="password" type="password" value="private-password"><textarea>private-textarea</textarea><button id="save">Save changes</button>';
  const result = collectPreviewDom();
  expect(result.elements.find((e) => e.selector === "#name")).toMatchObject({
    name: "Display name",
    tag: "input",
    text: "",
  });
  expect(result.elements.find((e) => e.selector === "#save")).toMatchObject({
    text: "Save changes",
    bounds: { width: 100 },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private-value|private-password|private-textarea/,
  );
});
it("omits hidden/inert controls and creates positional selectors for duplicate IDs", () => {
  document.body.innerHTML =
    '<button hidden>Hidden</button><div inert><button>Inert</button></div><button id="dup">First</button><button id="dup">Second</button>';
  const result = collectPreviewDom();
  expect(result.elements).toHaveLength(2);
  const selectors = result.elements.map((e) => e.selector as string);
  expect(new Set(selectors).size).toBe(2);
  for (const selector of selectors)
    expect(document.querySelectorAll(selector)).toHaveLength(1);
});
it("bounds large pages and marks the snapshot incomplete", () => {
  document.body.innerHTML = Array.from(
    { length: 1000 },
    (_, i) => `<button id="b${i}">${"x".repeat(300)}</button>`,
  ).join("");
  const result = collectPreviewDom();
  expect(result.truncated).toBe(true);
  expect(result.elements.length).toBeLessThanOrEqual(50);
  expect(JSON.stringify(result).length).toBeLessThan(14000);
});
