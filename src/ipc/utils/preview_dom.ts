/** Self-contained so Playwright can serialize it into the isolated preview page.
 * Deliberately does not read form values, cookies, storage, raw HTML or frames.
 */
export function collectPreviewDom() {
  const elements: Array<Record<string, unknown>> = [];
  let size = 0;
  let scanned = 0;
  let truncated = false;
  function selectorFor(element: Element) {
    if (
      element.id &&
      document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
    )
      return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let node: Element | null = element;
    while (node && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (child) => child.tagName === node!.tagName,
          )
        : [];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  for (const element of document.querySelectorAll(
    "a,button,input,textarea,select,[role],[contenteditable='true']",
  )) {
    if (++scanned > 3000 || elements.length >= 50) {
      truncated = true;
      break;
    }
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      !box.width ||
      !box.height ||
      style.visibility === "hidden" ||
      element.closest('[aria-hidden="true"],[inert]')
    )
      continue;
    const tag = element.tagName.toLowerCase();
    const selector = selectorFor(element);
    if (selector.length > 600) {
      truncated = true;
      continue;
    }
    const field =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      (element as HTMLElement).isContentEditable;
    const entry = {
      selector,
      tag,
      role: element.getAttribute("role"),
      name: (
        element.getAttribute("aria-label") ||
        ("labels" in element
          ? Array.from((element as HTMLInputElement).labels ?? [])
              .map((label) => label.textContent)
              .join(" ")
          : "") ||
        ""
      ).slice(0, 160),
      text: field
        ? ""
        : (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      type: element.getAttribute("type"),
      placeholder: element.getAttribute("placeholder")?.slice(0, 160),
      disabled: element.matches(":disabled,[aria-disabled='true']"),
      invalid: element.getAttribute("aria-invalid") === "true",
      bounds: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    };
    const length = JSON.stringify(entry).length;
    if (size + length > 11000) {
      truncated = true;
      break;
    }
    size += length;
    elements.push(entry);
  }
  return {
    url: location.href,
    title: document.title.slice(0, 200),
    readyState: document.readyState,
    viewport: { width: innerWidth, height: innerHeight },
    elements,
    truncated,
    scope:
      "Visible main-document controls only; no input values, storage, frames or closed shadow roots. Use precise selectors, not arbitrary JavaScript.",
  };
}
