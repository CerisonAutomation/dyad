import { z } from "zod";
import {
  previewClick,
  previewConsole,
  previewNavigate,
  previewRead,
  previewScreenshot,
  previewType,
} from "@/ipc/utils/preview_browser_driver";
import { getRunningTestBaseUrl } from "@/ipc/handlers/tests_handlers";
import type { ToolDefinition } from "./types";

const previewBrowserSchema = z.object({
  action: z
    .enum(["navigate", "click", "type", "read", "console", "screenshot"])
    .describe(
      "What to do in the running app preview. " +
        "navigate: load a path (relative paths resolve against the preview, so '/' is the app root). " +
        "click: click the first element matching a CSS selector. " +
        "type: fill an input; set submit to true to press Enter after. " +
        "read: return the page title, url, and the text a user would see. " +
        "console: return console output and uncaught errors from the preview. " +
        "screenshot: capture the preview as a PNG data URL.",
    ),
  path: z
    .string()
    .optional()
    .describe("Path or absolute URL for 'navigate'. Defaults to the app root."),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector for 'click' and 'type', e.g. 'button[type=submit]'.",
    ),
  text: z.string().optional().describe("Text to type for 'type'."),
  submit: z
    .boolean()
    .optional()
    .describe("Press Enter after typing. Defaults to false."),
});

export const previewBrowserTool: ToolDefinition = {
  name: "preview_browser",
  description:
    "Inspect and drive the app running in the preview pane. Use this to verify your changes actually work: navigate to a route, click a control, fill a form, read what the user would see, check the console for errors, or capture a screenshot. Works with any dev server. The app must already be running.",
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
        return `Click ${args.selector} in the preview`;
      case "type":
        return `Type into ${args.selector} in the preview`;
      default:
        return `Read ${args.action} from the running preview`;
    }
  },
  isEnabled: (ctx) => Boolean(getRunningTestBaseUrl(ctx.appId)),
  execute: async (args, ctx) => {
    const { action } = args;
    switch (action) {
      case "navigate":
        return previewNavigate(ctx.appId, args.path ?? "/");
      case "click":
        if (!args.selector) throw new Error("'click' requires a CSS selector.");
        return previewClick(ctx.appId, args.selector);
      case "type":
        if (!args.selector || args.text === undefined)
          throw new Error("'type' requires a selector and text.");
        return previewType(
          ctx.appId,
          args.selector,
          args.text,
          args.submit ?? false,
        );
      case "read":
        return previewRead(ctx.appId);
      case "console":
        return previewConsole(ctx.appId);
      case "screenshot":
        return previewScreenshot(ctx.appId);
      default:
        throw new Error(`Unsupported preview_browser action: ${action}`);
    }
  },
};
