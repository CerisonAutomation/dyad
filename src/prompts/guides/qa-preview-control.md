---
name: preview-control
description: Use this guide when the assignment involves seeing or driving the running app preview — taking screenshots, inspecting rendered UI, clicking, typing, or verifying visual state. Routes the work through the Comet browser MCP server against the Dyad preview URL.
---

# Preview Control

The agent cannot screenshot or drive the native preview surface directly. The Comet browser MCP server ("Comet Browser" in Settings → MCP servers) loads the same app over HTTP and gives full see-and-drive capability from chat.

## Preview URL

- Default: `http://localhost:42140/` (the Dyad preview proxy for the selected app).
- Override with the `DYAD_PREVIEW_URL` environment variable when the preview runs elsewhere.
- Always navigate to this URL first unless the active tab already shows it.

## One-call screenshot

- Call the `preview_snapshot` tool with no arguments. It navigates to the preview URL only when needed, settles the page, and returns a screenshot image plus the page title, URL, and saved PNG path.
- Use this for "show me the preview", visual verification after edits, and regression screenshots.

## Drive and inspect

- `navigate` — load the preview URL (or any app route under it).
- `read_page` — accessibility snapshot with `ref_N` element handles for the current page.
- `find` — locate an element by visible text; falls back to a CSS selector when given.
- `computer` with action `screenshot` — raw screenshot; with `left_click`, `type`, `scroll`, `press_key`, `hover` — drive the page using `ref_N` handles or coordinates from the latest snapshot.
- `form_input` — fill text fields, selects, checkboxes, and file inputs.
- `javascript_tool` with action `javascript_exec` — evaluate a JS expression and get the serialized result. Prefer `find`/`computer` for UI interaction; use this for reading app state.
- `console_messages` — page console errors and warnings after a load or interaction.
- `tabs_context` / `tabs_create` / `tabs_close` — manage multiple preview pages.

## Rules

- Screenshot before claiming a visual state; never describe UI you have not observed through `preview_snapshot` or `read_page`.
- After code edits that affect the UI, reload via `navigate` and take a fresh `preview_snapshot` before reporting the result.
- Report console errors from `console_messages` alongside any visual finding.

<nextjs-only>

## Path: Next.js preview

The Next.js dev server serves the preview; no extra steps are needed before screenshotting. If the app uses Next.js middleware redirects (e.g. locale or auth gates), pass the final route to `navigate` and confirm the snapshot shows the intended page before capturing.

</nextjs-only>

<vite-nitro-only>

## Path: Vite + Nitro preview

The Vite dev server serves the preview through the Dyad proxy; screenshot and drive it exactly as above. If the app has server routes that require the Nitro layer, load those routes via `navigate` first so the snapshot reflects server-rendered state.

</vite-nitro-only>
