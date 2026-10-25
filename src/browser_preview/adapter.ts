import { themesData } from "../shared/themes";
import { localTemplatesData } from "../shared/templates";

/** Read-only fixtures for the Vite renderer, never a desktop/backend substitute. */
export function isBrowserPreview(): boolean {
  return Boolean(
    import.meta.env.DEV &&
    import.meta.env.MODE === "browser-preview" &&
    typeof window !== "undefined" &&
    !(window as Window & { electron?: { ipcRenderer?: unknown } }).electron
      ?.ipcRenderer,
  );
}

export async function invokeBrowserPreview(channel: string): Promise<unknown> {
  switch (channel) {
    case "get-user-settings":
      return {
        selectedModel: {
          name: "auto",
          provider: "auto",
          connection: "api-key",
        },
        providerSettings: {},
        selectedTemplateId: "react",
        selectedChatMode: "build",
        telemetryConsent: "opted_out",
        lastShownReleaseNotesVersion: "0.0.0-browser-preview",
        hasRunBefore: true,
        isRunning: false,
        enableAutoUpdate: false,
        releaseChannel: "stable",
      };
    case "get-themes":
      return structuredClone(themesData);
    case "get-templates":
      return structuredClone(localTemplatesData);
    case "get-custom-themes":
      return [];
    case "list-apps":
      return { apps: [] };
    case "get-env-vars":
    case "get-language-models-by-providers":
      return {};
    case "get-language-model-providers":
    case "get-language-models":
    case "appCollections:list":
    case "prompts:list":
    case "get-chats":
    case "search-chats":
      return [];
    case "get-system-platform":
      return "linux";
    case "get-app-version":
      return { version: "0.0.0-browser-preview" };
    case "does-release-note-exist":
      return { exists: false };
    case "codex-subscription:status":
      return {
        connected: false,
        pending: false,
        models: [],
        limitReached: false,
        windows: [],
      };
    case "native-theme:get-state":
      return {
        shouldUseDarkColors: window.matchMedia("(prefers-color-scheme: dark)")
          .matches,
      };
    case "get-custom-apps-folder":
      return {
        path: "Unavailable in browser preview",
        isPathAvailable: false,
        isPathDefault: true,
      };
    case "nodejs-status":
      return {
        nodeVersion: null,
        pnpmVersion: null,
        nodeDownloadUrl: "",
        source: null,
        nodePath: null,
        managedNodeInstalled: false,
        managedNodeVersion: null,
        systemNodeTooOld: false,
        managedNodeSupported: false,
      };
    case "get-system-debug-info":
      return {
        nodeVersion: null,
        pnpmVersion: null,
        nodePath: null,
        telemetryId: "",
        telemetryConsent: "opted_out",
        telemetryUrl: "",
        dyadVersion: "0.0.0-browser-preview",
        platform: "browser-preview",
        architecture: "unavailable",
        logs: "Desktop diagnostics are unavailable in browser preview.",
        updaterLogs: null,
        selectedLanguageModel: "Not connected",
      };
    case "get-user-budget":
      return null;
    default:
      throw new Error(
        `Browser preview is read-only: ${channel} requires the Electron desktop backend.`,
      );
  }
}
