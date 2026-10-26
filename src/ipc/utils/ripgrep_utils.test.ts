import { afterEach, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { getRgExecutablePath } from "./ripgrep_utils";
const state = vi.hoisted(() => ({ isPackaged: false }));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getAppPath: () => "/fixture-project",
  },
}));
afterEach(() => {
  state.isPackaged = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("keeps the bundled development path by default", () => {
  vi.stubEnv("DYAD_DEV_RIPGREP_EXECUTABLE", "");
  expect(getRgExecutablePath()).toContain(
    path.join("node_modules", "@vscode", "ripgrep", "bin"),
  );
});
it("validates an explicitly selected development binary before returning it", () => {
  const executable = path.resolve("fixture-rg");
  vi.stubEnv("DYAD_DEV_RIPGREP_EXECUTABLE", executable);
  vi.spyOn(fs, "statSync").mockReturnValue({ isFile: () => true } as fs.Stats);
  const access = vi.spyOn(fs, "accessSync").mockImplementation(() => {});
  expect(getRgExecutablePath()).toBe(executable);
  expect(access).toHaveBeenCalledWith(executable, constants.X_OK);
});
it("rejects relative executable overrides", () => {
  vi.stubEnv("DYAD_DEV_RIPGREP_EXECUTABLE", "./rg");
  expect(getRgExecutablePath).toThrow("absolute executable file");
});
it("never applies development overrides in packaged applications", () => {
  state.isPackaged = true;
  vi.stubGlobal("process", { ...process, resourcesPath: "/fixture-resources" });
  vi.stubEnv("DYAD_DEV_RIPGREP_EXECUTABLE", "/untrusted/rg");
  const stat = vi.spyOn(fs, "statSync");
  expect(getRgExecutablePath()).toContain(
    path.join("fixture-resources", "@vscode", "ripgrep", "bin"),
  );
  expect(stat).not.toHaveBeenCalled();
});
