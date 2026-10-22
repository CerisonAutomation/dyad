import { z } from "zod";
import {
  previewBatch,
  previewClick,
  previewClickAt,
  previewClickRef,
  previewConsole,
  previewContent,
  previewDom,
  previewEval,
  previewFind,
  previewFormInput,
  previewGoBack,
  previewHover,
  previewNavigate,
  previewNetwork,
  previewPressKey,
  previewRead,
  previewReload,
  previewScroll,
  previewScrollToRef,
  previewScreenshot,
  previewSnapshot,
  previewTabs,
  previewType,
  previewTypeRef,
  previewWait,
  type PreviewBatchAction,
} from "@/ipc/utils/preview_browser_driver";
import { getRunningTestBaseUrl } from "@/ipc/handlers/tests_handlers";
import type { ToolDefinition } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertNotPrivateIp } from "./network_utils";

/**
 * One step of a batch.
 *
 * Every step names its own action, so a batch reads like a short script:
 * `[{action:"click", ref:"ref_2"}, {action:"type", ref:"ref_3", text:"hi"}]`.
 */
const previewBatchActionSchema = z.object({
  action: z.string().describe("The action to run, e.g. 'click' or 'navigate'."),
  selector: z.string().optional(),
  ref: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
  submit: z.boolean().optional(),
  kind: z.enum(["text", "select", "checkbox", "radio", "file"]).optional(),
  checked: z.boolean().optional(),
  file_path: z.string().optional(),
  delta_x: z.number().optional(),
  delta_y: z.number().optional(),
  index: z.number().optional(),
  expression: z.string().optional(),
  tab_action: z.enum(["list", "new", "switch", "close"]).optional(),
  state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
  timeout_ms: z.number().optional(),
  full_page: z.boolean().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const previewBrowserSchema = z.object({
  action: z
    .enum([
      "navigate",
      "click",
      "click_at",
      "type",
      "read",
      "content",
      "console",
      "network",
      "screenshot",
      "snapshot",
      "dom",
      "find",
      "hover",
      "scroll",
      "scroll_to",
      "press_key",
      "wait",
      "back",
      "reload",
      "form_input",
      "evaluate",
      "tabs",
      "batch",
    ])
    .describe(
      "What to do in the running app preview. " +
        "navigate: load a path (relative paths resolve against the preview, so '/' is the app root). " +
        "click: click an element, addressed either by a CSS selector or by a 'ref' handle from 'snapshot'/'find'/'dom'. " +
        "click_at: click a point on the screen, using the x/y coordinates reported by the 'dom' outline. " +
        "type: fill an input (selector or 'ref'), optionally pressing Enter afterwards. " +
        "read: return the page title, url, and the text a user would see. " +
        "content: return the full readable content of the page (headings, text, links). " +
        "console: return console output and uncaught errors from the preview. " +
        "network: return the requests the preview failed, that errored, or that are still pending. " +
        "screenshot: capture the preview as a PNG data URL (of one element by 'ref', or of the whole page with full_page). " +
        "snapshot: list the interactive elements of the page as an accessibility outline, each with a 'ref' handle. " +
        "dom: return the accessibility outline of the page: role, accessible name, 'ref' handle, citation id and screen position for each node. " +
        "find: locate an element by visible text (or CSS selector) and return its 'ref' handle. " +
        "hover: hover an element addressed by a 'ref'. " +
        "scroll: scroll the page by a pixel delta. " +
        "scroll_to: scroll an element addressed by a 'ref' into view. " +
        "press_key: press a key such as Enter, Escape or Tab. " +
        "wait: wait for a selector, some text, a URL or the network to settle instead of guessing with a pause. " +
        "back: go back to the previous page. " +
        "reload: reload the current page. " +
        "form_input: fill a text field, select, checkbox, radio or file input addressed by a 'ref'. " +
        "evaluate: evaluate a JavaScript expression in the preview page and return the serialized result. " +
        "tabs: list, open, switch to or close preview tabs. " +
        "batch: run several actions in one call; give them in 'actions' as a list of {action, ...} objects. " +
        "The batch stops at the first failure.",
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
  state: z
    .enum(["visible", "hidden", "attached", "detached"])
    .optional()
    .describe(
      "The state to wait for in the 'wait' action. Defaults to 'visible'.",
    ),
  timeout_ms: z
    .number()
    .optional()
    .describe(
      "How long the 'wait' action may block, in milliseconds. Defaults to 10000.",
    ),
  full_page: z
    .boolean()
    .optional()
    .describe(
      "Capture the whole scrollable page in the 'screenshot' action. Defaults to false.",
    ),
  selectors: z
    .array(z.string())
    .optional()
    .describe(
      "CSS selectors to scope the 'content' action to. Selectors that match nothing are reported back.",
    ),
  x: z
    .number()
    .optional()
    .describe(
      "X coordinate in CSS pixels for 'click_at', as reported by the 'dom' outline.",
    ),
  y: z
    .number()
    .optional()
    .describe(
      "Y coordinate in CSS pixels for 'click_at', as reported by the 'dom' outline.",
    ),
  filter: z
    .enum(["interactive", "all", "viewport"])
    .optional()
    .describe(
      "Which nodes the 'dom' outline should include. Defaults to 'interactive'.",
    ),
  depth: z
    .number()
    .optional()
    .describe("How deep the 'dom' outline should descend. Defaults to 12."),
  actions: z
    .array(previewBatchActionSchema)
    .optional()
    .describe(
      "The steps to run for the 'batch' action, in order. Each step is an object with an 'action' and the arguments that action needs.",
    ),
});

export const previewBrowserTool: ToolDefinition = {
  name: "preview_browser",
  description:
    "Inspect and drive the app running in the preview pane. Use this to verify your changes actually work: take an accessibility outline or snapshot of the page, navigate to a route, click or type into an element, click a screen coordinate, fill a form, hover, scroll, press a key, read what the user would see, wait for the page to settle, check the console and the network for errors, evaluate JavaScript in the page, manage preview tabs, capture a screenshot, or run a short batch of actions in one call. Works with any dev server. The app must already be running.",
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
      case "content":
        return `Read the full content of the preview page`;
      case "network":
        return `Read the preview network failures`;
      case "wait":
        return `Wait for ${
          args.selector ?? args.text ?? args.url ?? "the page"
        } in the preview`;
      case "scroll_to":
        return `Scroll ${args.ref} into view in the preview`;
      case "dom":
        return `Read the accessibility outline of the preview page`;
      case "batch":
        return `Run ${args.actions?.length ?? 0} preview action(s) in one call`;
      case "click_at":
        return `Click at (${args.x ?? "?"}, ${args.y ?? "?"}) in the preview`;
      case "back":
        return `Go back to the previous page in the preview`;
      case "reload":
        return `Reload the preview page`;
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
      case "click_at": {
        if (args.x === undefined || args.y === undefined)
          throw new DyadError(
            "'click_at' requires the x and y coordinates reported by the 'dom' outline.",
            DyadErrorKind.Validation,
          );
        return previewClickAt(ctx.appId, args.x, args.y);
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
      case "content":
        return previewContent(ctx.appId, args.selectors);
      case "console":
        return previewConsole(ctx.appId);
      case "network":
        return previewNetwork(ctx.appId);
      case "screenshot":
        return previewScreenshot(ctx.appId, {
          ref: args.ref,
          fullPage: args.full_page,
        });
      case "snapshot":
        return previewSnapshot(ctx.appId);
      case "dom":
        return previewDom(ctx.appId, {
          filter: args.filter,
          depth: args.depth,
        });
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
      case "scroll_to": {
        if (!args.ref)
          throw new DyadError(
            "'scroll_to' requires a 'ref' handle from 'snapshot' or 'find'.",
            DyadErrorKind.Validation,
          );
        return previewScrollToRef(ctx.appId, args.ref);
      }
      case "back":
        return previewGoBack(ctx.appId);
      case "reload":
        return previewReload(ctx.appId);
      case "press_key": {
        if (!args.key)
          throw new DyadError(
            "'press_key' requires a key, e.g. 'Enter'.",
            DyadErrorKind.Validation,
          );
        return previewPressKey(ctx.appId, args.key);
      }
      case "wait": {
        if (!args.selector && !args.text && !args.url)
          throw new DyadError(
            "'wait' requires a 'selector', 'text' or 'url' to wait for.",
            DyadErrorKind.Validation,
          );
        return previewWait(ctx.appId, {
          selector: args.selector,
          text: args.text,
          url: args.url,
          state: args.state,
          timeoutMs: args.timeout_ms,
        });
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
      case "batch": {
        if (!args.actions || args.actions.length === 0)
          throw new DyadError(
            "'batch' requires at least one step in 'actions'.",
            DyadErrorKind.Validation,
          );
        return previewBatch(ctx.appId, args.actions as PreviewBatchAction[]);
      }
      default:
        throw new DyadError(
          `Unsupported preview_browser action: ${action}`,
          DyadErrorKind.Validation,
        );
    }
  },
};
