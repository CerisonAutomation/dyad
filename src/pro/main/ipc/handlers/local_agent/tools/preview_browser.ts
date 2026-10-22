import { z } from "zod";
import {
  previewClick,
  previewClickRef,
  previewConsole,
  previewEval,
  previewFind,
  previewFormInput,
  previewHover,
  previewNavigate,
  previewPressKey,
  previewRead,
  previewScroll,
  previewScreenshot,
  previewSnapshot,
  previewTabs,
  previewType,
  previewTypeRef,
} from "@/ipc/utils/preview_browser_driver";
import { getRunningTestBaseUrl } from "@/ipc/handlers/tests_handlers";
import type { ToolDefinition } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertNotPrivateIp } from "./network_utils";

const previewBrowserSchema = z.object({
  action: z
    .enum([
      "navigate",
      "click",
      "type",
      "read",
      "console",
      "screenshot",
      "snapshot",
      "find",
      "hover",
      "scroll",
      "press_key",
      "form_input",
      "evaluate",
      "tabs",
    ])
    .describe(
      "What to do in the running app preview. " +
        "navigate: load a path (relative paths resolve against the preview, so '/' is the app root). " +
        "click: click an element, addressed either by a CSS selector or by a 'ref' handle from 'snapshot'/'find'. " +
        "type: fill an input (selector or 'ref'), optionally pressing Enter afterwards. " +
        "read: return the page title, url, and the text a user would see. " +
        "console: return console output and uncaught errors from the preview. " +
        "screenshot: capture the preview as a PNG data URL. " +
        "snapshot: list the interactive elements of the page as an accessibility outline, each with a 'ref' handle. " +
        "find: locate an element by visible text (or CSS selector) and return its 'ref' handle. " +
        "hover: hover an element addressed by a 'ref'. " +
        "scroll: scroll the page by a pixel delta. " +
        "press_key: press a key such as Enter, Escape or Tab. " +
        "form_input: fill a text field, select, checkbox, radio or file input addressed by a 'ref'. " +
        "evaluate: evaluate a JavaScript expression in the preview page and return the serialized result. " +
        "tabs: list, open, switch to or close preview tabs.",
    ),
  path: z
    .string()
    .optional()
    .describe("Path or absolute URL for 'navigate'. Defaults to the app root."),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector for 'click', 'type' and 'find', e.g. 'button[type=submit]'.",
    ),
  text: z
    .string()
    .optional()
    .describe(
      "Text to type for 'type', or the visible text to look for in 'find'.",
    ),
  submit: z
    .boolean()
    .optional()
    .describe("Press Enter after typing. Defaults to false."),
  ref: z
    .string()
    .optional()
    .describe(
      "Element handle from 'snapshot' or 'find', e.g. 'ref_3'. Use it for 'click', 'type', 'hover' and 'form_input'.",
    ),
  kind: z
    .enum(["text", "select", "checkbox", "radio", "file"])
    .optional()
    .describe(
      "Which kind of control 'form_input' should fill. Defaults to 'text'.",
    ),
  value: z
    .string()
    .optional()
    .describe("Value to enter for 'form_input' (text or select option)."),
  checked: z
    .boolean()
    .optional()
    .describe("Target state for a 'form_input' on a checkbox or radio."),
  file_path: z
    .string()
    .optional()
    .describe(
      "Absolute path of the file to upload for a 'form_input' of kind 'file'.",
    ),
  key: z
    .string()
    .optional()
    .describe("Key to press for 'press_key', e.g. 'Enter', 'Escape', 'Tab'."),
  delta_x: z
    .number()
    .optional()
    .describe(
      "Horizontal scroll amount in pixels for 'scroll'. Defaults to 0.",
    ),
  delta_y: z
    .number()
    .optional()
    .describe(
      "Vertical scroll amount in pixels for 'scroll'. Defaults to 600.",
    ),
  index: z
    .number()
    .optional()
    .describe(
      "Zero-based match index for 'find', or tab index for the 'tabs' action.",
    ),
  expression: z
    .string()
    .optional()
    .describe("JavaScript expression to evaluate in the preview page."),
  tab_action: z
    .enum(["list", "new", "switch", "close"])
    .optional()
    .describe("What the 'tabs' action should do. Defaults to 'list'."),
  url: z
    .string()
    .optional()
    .describe("URL to open when the 'tabs' action creates a new tab."),
});

export const previewBrowserTool: ToolDefinition = {
  name: "preview_browser",
  description:
    "Inspect and drive the app running in the preview pane. Use this to verify your changes actually work: take an accessibility snapshot of the page, navigate to a route, click or type into an element, fill a form, hover, scroll, press a key, read what the user would see, check the console for errors, evaluate JavaScript in the page, manage preview tabs, or capture a screenshot. Works with any dev server. The app must already be running.",
  inputSchema: previewBrowserSchema,
  defaultConsent: "always",
  // Reading and clicking the user's own dev app is inspection of what they
  // built, not a mutation of project files, so it stays available in Ask mode.
  modifiesState: false,
  getConsentPreview: (args) => {
    switch (args.action) {
      case "navigate":
        return `Navigate the preview to ${args.path ?? "/"}`;
      case "click":
        return `Click ${args.ref ?? args.selector} in the preview`;
      case "type":
        return `Type into ${args.ref ?? args.selector} in the preview`;
      case "find":
        return `Find "${args.text ?? args.selector}" in the preview`;
      case "hover":
        return `Hover ${args.ref} in the preview`;
      case "form_input":
        return `Fill the ${args.kind ?? "text"} control ${args.ref} in the preview`;
      case "evaluate":
        return `Evaluate JavaScript in the preview page`;
      case "tabs":
        return `Manage preview tabs (${args.tab_action ?? "list"})`;
      case "press_key":
        return `Press ${args.key} in the preview`;
      case "scroll":
        return `Scroll the preview by (${args.delta_x ?? 0}, ${args.delta_y ?? 600})`;
      default:
        return `Read ${args.action} from the running preview`;
    }
  },
  isEnabled: (ctx) => Boolean(getRunningTestBaseUrl(ctx.appId)),
  execute: async (args, ctx) => {
    const { action } = args;
    switch (action) {
      case "navigate": {
        const path = args.path ?? "/";
        // Absolute URLs bypass the preview proxy and would let the agent drive
        // the browser at private/internal addresses (SSRF), so they go through
        // the same guard web_fetch/web_crawl use.
        if (/^https?:\/\//i.test(path)) {
          await assertNotPrivateIp(path);
        }
        return previewNavigate(ctx.appId, path);
      }
      case "click": {
        // A 'ref' handle from snapshot/find is preferred: CSS selectors are
        // brittle against generated markup, handles are not.
        if (args.ref) {
          return previewClickRef(ctx.appId, args.ref);
        }
        if (!args.selector)
          throw new DyadError(
            "'click' requires a CSS selector or a 'ref' handle.",
            DyadErrorKind.Validation,
          );
        return previewClick(ctx.appId, args.selector);
      }
      case "type": {
        if (args.text === undefined)
          throw new DyadError(
            "'type' requires text.",
            DyadErrorKind.Validation,
          );
        if (args.ref) {
          return previewTypeRef(
            ctx.appId,
            args.ref,
            args.text,
            args.submit ?? false,
          );
        }
        if (!args.selector)
          throw new DyadError(
            "'type' requires a selector or a 'ref' handle.",
            DyadErrorKind.Validation,
          );
        return previewType(
          ctx.appId,
          args.selector,
          args.text,
          args.submit ?? false,
        );
      }
      case "read":
        return previewRead(ctx.appId);
      case "console":
        return previewConsole(ctx.appId);
      case "screenshot":
        return previewScreenshot(ctx.appId);
      case "snapshot":
        return previewSnapshot(ctx.appId);
      case "find": {
        if (!args.text && !args.selector)
          throw new DyadError(
            "'find' requires visible text to look for, or a CSS selector.",
            DyadErrorKind.Validation,
          );
        return previewFind(
          ctx.appId,
          args.text ?? "",
          args.selector,
          args.index,
        );
      }
      case "hover": {
        if (!args.ref)
          throw new DyadError(
            "'hover' requires a 'ref' handle from 'snapshot' or 'find'.",
            DyadErrorKind.Validation,
          );
        return previewHover(ctx.appId, args.ref);
      }
      case "scroll":
        return previewScroll(ctx.appId, args.delta_x ?? 0, args.delta_y ?? 600);
      case "press_key": {
        if (!args.key)
          throw new DyadError(
            "'press_key' requires a key, e.g. 'Enter'.",
            DyadErrorKind.Validation,
          );
        return previewPressKey(ctx.appId, args.key);
      }
      case "form_input": {
        if (!args.ref)
          throw new DyadError(
            "'form_input' requires a 'ref' handle from 'snapshot' or 'find'.",
            DyadErrorKind.Validation,
          );
        return previewFormInput(
          ctx.appId,
          args.ref,
          args.kind ?? "text",
          args.value,
          args.checked,
          args.file_path,
        );
      }
      case "evaluate": {
        if (!args.expression)
          throw new DyadError(
            "'evaluate' requires a JavaScript expression.",
            DyadErrorKind.Validation,
          );
        return previewEval(ctx.appId, args.expression);
      }
      case "tabs":
        return previewTabs(
          ctx.appId,
          args.tab_action ?? "list",
          args.index,
          args.url,
        );
      default:
        throw new DyadError(
          `Unsupported preview_browser action: ${action}`,
          DyadErrorKind.Validation,
        );
    }
  },
};
