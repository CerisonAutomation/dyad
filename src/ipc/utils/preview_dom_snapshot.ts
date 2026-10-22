/**
 * Accessibility-style outline of the preview page.
 *
 * Comet hands its model an accessibility tree: every node carries a stable
 * handle and a screen position, so the model can reason about what is on the
 * page and click by coordinate when a handle is not enough. This module
 * formats the same shape from a plain node list, so the formatting stays
 * testable without a browser.
 */

/** A single node of the outline. Positions are CSS pixels in the viewport. */
export interface DomNode {
  /** Stable handle on the DOM node, e.g. "ref_3". */
  ref?: string;
  /** Accessible role, e.g. "button", "link", "textbox". */
  role: string;
  /** Accessible name, e.g. "Save changes". */
  name: string;
  /** Viewport position of the node. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  /** Nesting depth, used for indentation. */
  depth?: number;
}

/** Cap on nodes so a huge page cannot flood the context. */
export const MAX_DOM_ELEMENTS = 300;

/** Cap on nesting depth, so deep DOMs do not produce unreadable output. */
export const MAX_DOM_DEPTH = 12;

/** Accessible names are truncated: a paragraph is not a label. */
export const MAX_DOM_NAME_CHARS = 100;

export interface DomFormatOptions {
  maxDepth?: number;
  maxElements?: number;
}

/**
 * Format nodes as an indented outline, one per line.
 *
 * Every node gets a citation id (`element:1`, `element:2`, ...) so the model
 * can point at a specific thing in its answer.
 */
export function formatDomOutline(
  nodes: DomNode[],
  options: DomFormatOptions = {},
): string {
  const maxDepth = options.maxDepth ?? MAX_DOM_DEPTH;
  const maxElements = options.maxElements ?? MAX_DOM_ELEMENTS;
  const lines: string[] = [];
  for (const [index, node] of nodes.entries()) {
    if (lines.length >= maxElements) break;
    if ((node.depth ?? 0) > maxDepth) continue;
    lines.push(formatDomNode(node, index + 1));
  }
  return lines.join("\n");
}

function formatDomNode(node: DomNode, ordinal: number): string {
  const indent = "  ".repeat(Math.max(0, node.depth ?? 0));
  const handle = node.ref ? `[ref=${node.ref}]` : "";
  const id = `[element:${ordinal}]`;
  const position =
    node.x !== undefined && node.y !== undefined
      ? ` (x=${Math.round(node.x)},y=${Math.round(node.y)})`
      : "";
  const state = [
    node.disabled ? "disabled" : "",
    node.checked ? "checked" : "",
    node.value ? `value=${JSON.stringify(node.value)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const name = truncateDomName(node.name);
  return `${indent}- ${node.role}${handle}${id}${position} "${name}"${
    state ? ` (${state})` : ""
  }`;
}

function truncateDomName(name: string): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_DOM_NAME_CHARS) return clean;
  return `${clean.slice(0, MAX_DOM_NAME_CHARS)}…`;
}

/**
 * The click target inside a box: its centre.
 *
 * Clicking a node by coordinate is what a vision-driven agent does, and the
 * centre of the box is the point least likely to land on a border.
 */
export function boundingCenter(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

/**
 * Map a tag (and its attributes) to the role a screen reader would report.
 *
 * Kept as a pure function so the mapping can be tested without a DOM.
 */
export function domRoleForTag(
  tag: string,
  attributes: { role?: string; type?: string; href?: string } = {},
): string {
  if (attributes.role) return attributes.role;
  switch (tag) {
    case "a":
      return attributes.href ? "link" : "generic";
    case "button":
    case "summary":
      return "button";
    case "input":
      switch (attributes.type) {
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "submit":
        case "button":
        case "reset":
        case "image":
          return "button";
        case "range":
          return "slider";
        case "number":
          return "spinbutton";
        case "search":
          return "searchbox";
        default:
          return "textbox";
      }
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "option":
      return "option";
    case "img":
      return attributes.href ? "link" : "img";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "form":
      return "form";
    case "table":
      return "table";
    case "ul":
    case "ol":
      return "list";
    case "li":
      return "listitem";
    case "p":
      return "paragraph";
    case "label":
      return "label";
    case "dialog":
      return "dialog";
    case "progress":
      return "progressbar";
    default:
      return "generic";
  }
}
