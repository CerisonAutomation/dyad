---
name: preview-control
description: Use this guide when the assignment involves seeing or driving the running app preview — taking screenshots, inspecting rendered UI, clicking, typing, or verifying visual state. Uses the native preview_browser tool against the app preview.
---

# Preview Control

The `preview_browser` tool drives the app that is already running in the preview pane: it opens its own browser session against the preview URL, so the agent can see the rendered UI and interact with it directly. No external browser MCP server is needed.

Use the tool with the `action` parameter. Every action returns a short text result; `screenshot` returns an image.

## Preview URL

- Default: the app root of the running preview (relative paths like `/` resolve against it).
- Pass an absolute `http(s)` URL to `navigate` to reach a specific route or a different server. Absolute URLs are checked against private/internal addresses and rejected when they point at the local network.

## One-call screenshot

- Call `preview_browser` with `action: "screenshot"` to capture the preview as a PNG data URL. Large images are re-encoded as JPEG automatically so the result always fits in the model's context.
- Use this for "show me the preview", visual verification after edits, and regression screenshots.
- `preview_browser` with `action: "snapshot"` (the `preview_snapshot` flow) returns the interactive elements of the page as an accessibility outline — cheaper than a screenshot when you only need to know what is on the page.

## Drive and inspect

- `action: "navigate"` with `path` — load a route (relative paths resolve against the preview, so `/` is the app root).
- `action: "snapshot"` — accessibility-style outline of the interactive elements (links, buttons, inputs, selects, textareas, tabs, headings). Every element gets a `ref_N` handle you can then act on. This is the `read_page` equivalent.
- `action: "find"` with `text` (or `selector`) — locate an element by visible text; falls back to a CSS selector when given. Returns a `ref_N` handle plus a description of the match. Use `index` to pick among several matches.
- `action: "click"` with `ref` (preferred) or `selector` — click the element.
- `action: "type"` with `ref` or `selector` plus `text` — fill an input; set `submit: true` to press Enter afterwards.
- `action: "form_input"` with `ref` and `kind` — fill a `text` field, choose a `select` option, toggle a `checkbox`/`radio` (with `checked`), or upload a `file` (with `file_path`).
- `action: "hover"` with `ref` — hover the element.
- `action: "scroll"` with `delta_x` / `delta_y` — scroll the page by a pixel delta.
- `action: "press_key"` with `key` — press a key such as `Enter`, `Escape` or `Tab`.
- `action: "read"` — page title, URL and the text a user would see.
- `action: "evaluate"` with `expression` — evaluate a JavaScript expression in the preview page and get the serialized result. Prefer `find`/`click` for UI interaction; use this for reading app state.
- `action: "console"` — console output and uncaught errors from the preview after a load or interaction.
- `action: "tabs"` with `tab_action` (`list`, `new`, `switch`, `close`) — manage multiple preview pages.

## Rules

- Observe before claiming a visual state; never describe UI you have not observed through `snapshot`, `read` or `screenshot`.
- After code edits that affect the UI, reload via `navigate` and take a fresh `snapshot`/`screenshot` before reporting the result.
- Report console errors from `console` alongside any visual finding.
- Refs are per-page and are invalidated by a reload: re-run `snapshot`/`find` after navigating.

<nextjs-only>

## Path: Next.js preview

The Next.js dev server serves the preview; no extra steps are needed before screenshotting. If the app uses Next.js middleware redirects (e.g. locale or auth gates), pass the final route to `navigate` and confirm the snapshot shows the intended page before capturing.

</nextjs-only>

<vite-nitro-only>

## Path: Vite + Nitro preview

The Vite dev server serves the preview through the Dyad proxy; screenshot and drive it exactly as above. If the app has server routes that require the Nitro layer, load those routes via `navigate` first so the snapshot reflects server-rendered state.

</vite-nitro-only>
