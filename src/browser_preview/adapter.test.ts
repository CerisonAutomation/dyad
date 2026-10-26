import { mcpContracts } from "../ipc/types/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBrowserPreview, invokeBrowserPreview } from "./adapter";
import { settingsContracts } from "../ipc/types/settings";
import { systemContracts } from "../ipc/types/system";
import { templateContracts } from "../ipc/types/templates";
import { appContracts } from "../ipc/types/app";
import { languageModelContracts } from "../ipc/types/language-model";
import { miscContracts } from "../ipc/types/misc";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("explicit development-only browser preview", () => {
  it("requires both development and the preview mode, with no Electron bridge", () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    expect(isBrowserPreview()).toBe(false);
    vi.stubEnv("MODE", "browser-preview");
    expect(isBrowserPreview()).toBe(true);
    vi.stubEnv("DEV", false);
    expect(isBrowserPreview()).toBe(false);
  });
  it("never replaces an Electron bridge", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "browser-preview");
    vi.stubGlobal("window", { electron: { ipcRenderer: {} } });
    expect(isBrowserPreview()).toBe(false);
  });
  it("is disabled outside a browser", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "browser-preview");
    vi.stubGlobal("window", undefined);
    expect(isBrowserPreview()).toBe(false);
  });
});

const fixtureContracts = [
  mcpContracts.listServers,
  mcpContracts.getToolConsents,
  mcpContracts.listCatalog,
  settingsContracts.getUserSettings,
  settingsContracts.getCodexSubscriptionStatus,
  systemContracts.getAppVersion,
  systemContracts.getSystemPlatform,
  systemContracts.getCustomAppsFolder,
  systemContracts.getSystemDebugInfo,
  systemContracts.getNodejsStatus,
  systemContracts.doesReleaseNoteExist,
  systemContracts.getUserBudget,
  templateContracts.getThemes,
  templateContracts.getCustomThemes,
  templateContracts.getTemplates,
  appContracts.listApps,
  languageModelContracts.getModelsByProviders,
  languageModelContracts.getModels,
  languageModelContracts.getProviders,
  miscContracts.getEnvVars,
];
it.each(fixtureContracts)(
  "fixture conforms to $channel contract",
  async ({ channel, output }) => {
    expect(output.safeParse(await invokeBrowserPreview(channel)).success).toBe(
      true,
    );
  },
);
it.each([
  "set-user-settings",
  "create-app",
  "chat:stream",
  "open-external-url",
  "read-app-file",
  "unknown-channel",
  "mcp:add-from-catalog",
  "mcp:create-server",
  "mcp:update-server",
  "mcp:delete-server",
  "mcp:set-tool-consent",
  "mcp:start-oauth",
  "mcp:disconnect-oauth",
  "mcp:probe-connection",
  "mcp:list-tools",
  "mcp:is-oauth-storage-encrypted",
])("rejects unsupported or mutating %s", async (channel) => {
  await expect(invokeBrowserPreview(channel)).rejects.toThrow(
    "requires the Electron desktop backend",
  );
});
it("returns fresh settings instead of persisting renderer mutations", async () => {
  const first = (await invokeBrowserPreview("get-user-settings")) as {
    providerSettings: Record<string, unknown>;
  };
  first.providerSettings.example = { apiKey: "not-a-real-key" };
  expect(
    ((await invokeBrowserPreview("get-user-settings")) as typeof first)
      .providerSettings,
  ).toEqual({});
});

it("shows real local catalog metadata without pretending any server is connected", async () => {
  const catalog = (await invokeBrowserPreview("mcp:list-catalog")) as {
    entries: { slug: string; args: string[] }[];
    addedSlugs: string[];
  };
  expect(
    catalog.entries.some((entry) => entry.slug === "shadcn-ui-registry"),
  ).toBe(true);
  expect(catalog.addedSlugs).toEqual([]);
  expect(await invokeBrowserPreview("mcp:list-servers")).toEqual([]);
  catalog.entries[0].args.push("modified");
  catalog.addedSlugs.push("fake-server");
  const fresh = (await invokeBrowserPreview(
    "mcp:list-catalog",
  )) as typeof catalog;
  expect(fresh.entries[0].args).not.toContain("modified");
  expect(fresh.addedSlugs).toEqual([]);
});
