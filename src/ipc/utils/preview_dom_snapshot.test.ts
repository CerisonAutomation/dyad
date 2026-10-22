import { describe, expect, it } from "vitest";
import {
  boundingCenter,
  domRoleForTag,
  formatDomOutline,
  MAX_DOM_ELEMENTS,
  type DomNode,
} from "./preview_dom_snapshot";

describe("formatDomOutline", () => {
  it("renders role, handle, citation id, position and name", () => {
    const lines = formatDomOutline([
      {
        role: "button",
        name: "Save changes",
        ref: "ref_3",
        x: 45,
        y: 90,
        depth: 0,
      },
    ]);
    expect(lines).toBe(
      '- button[ref=ref_3][element:1] (x=45,y=90) "Save changes"',
    );
  });

  it("indents by depth and numbers nodes so they can be cited", () => {
    const nodes: DomNode[] = [
      { role: "navigation", name: "Main", depth: 0 },
      { role: "link", name: "Docs", ref: "ref_1", depth: 1 },
      { role: "link", name: "Blog", ref: "ref_2", depth: 1 },
    ];
    const lines = formatDomOutline(nodes).split("\n");
    expect(lines[0]).toContain("[element:1]");
    expect(lines[1]).toContain("  - link");
    expect(lines[1]).toContain("[element:2]");
    expect(lines[2]).toContain("[element:3]");
  });

  it("reports state such as disabled, checked and value", () => {
    const line = formatDomOutline([
      { role: "checkbox", name: "Accept", disabled: true, checked: true },
    ]);
    expect(line).toContain("(disabled checked)");
  });

  it("truncates a very long accessible name", () => {
    const line = formatDomOutline([
      { role: "paragraph", name: "x".repeat(500) },
    ]);
    expect(line.length).toBeLessThan(200);
    expect(line).toContain("…");
  });

  it("caps the number of nodes it returns", () => {
    const nodes: DomNode[] = Array.from(
      { length: MAX_DOM_ELEMENTS + 50 },
      (_, index) => ({ role: "link", name: `link ${index}`, depth: 0 }),
    );
    const lines = formatDomOutline(nodes).split("\n");
    expect(lines.length).toBe(MAX_DOM_ELEMENTS);
  });

  it("skips nodes deeper than the depth limit", () => {
    const lines = formatDomOutline(
      [
        { role: "main", name: "root", depth: 0 },
        { role: "link", name: "deep", depth: 99 },
      ],
      { maxDepth: 5 },
    ).split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("main");
  });
});

describe("boundingCenter", () => {
  it("returns the middle of the box", () => {
    expect(boundingCenter({ x: 10, y: 20, width: 100, height: 40 })).toEqual({
      x: 60,
      y: 40,
    });
  });

  it("rounds to whole pixels", () => {
    expect(boundingCenter({ x: 0, y: 0, width: 5, height: 5 })).toEqual({
      x: 3,
      y: 3,
    });
  });
});

describe("domRoleForTag", () => {
  it("prefers an explicit role attribute", () => {
    expect(domRoleForTag("div", { role: "tab" })).toBe("tab");
  });

  it("maps links, buttons and inputs", () => {
    expect(domRoleForTag("a", { href: "/x" })).toBe("link");
    expect(domRoleForTag("a", {})).toBe("generic");
    expect(domRoleForTag("button", {})).toBe("button");
    expect(domRoleForTag("input", { type: "checkbox" })).toBe("checkbox");
    expect(domRoleForTag("input", { type: "radio" })).toBe("radio");
    expect(domRoleForTag("input", { type: "submit" })).toBe("button");
    expect(domRoleForTag("input", { type: "range" })).toBe("slider");
    expect(domRoleForTag("input", {})).toBe("textbox");
    expect(domRoleForTag("textarea", {})).toBe("textbox");
    expect(domRoleForTag("select", {})).toBe("combobox");
  });

  it("maps structural tags", () => {
    expect(domRoleForTag("h2", {})).toBe("heading");
    expect(domRoleForTag("nav", {})).toBe("navigation");
    expect(domRoleForTag("main", {})).toBe("main");
    expect(domRoleForTag("ul", {})).toBe("list");
    expect(domRoleForTag("li", {})).toBe("listitem");
    expect(domRoleForTag("div", {})).toBe("generic");
  });
});
