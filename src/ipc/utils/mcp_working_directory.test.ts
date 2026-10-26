// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveMcpWorkingDirectory } from "./mcp_working_directory";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agent2-mcp-cwd-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("preserves existing server cwd behavior without explicit project targeting", () => {
  expect(resolveMcpWorkingDirectory(null)).toBeUndefined();
});
it("requires an explicit target for the shadcn catalog preset", () => {
  expect(() => resolveMcpWorkingDirectory("shadcn-ui-registry")).toThrow(
    "DYAD_MCP_PROJECT_DIR",
  );
});
it("accepts a real project path without shell interpolation", () => {
  const directory = path.join(root, "app with spaces");
  fs.mkdirSync(directory);
  expect(
    resolveMcpWorkingDirectory("shadcn-ui-registry", {
      DYAD_MCP_PROJECT_DIR: directory,
    }),
  ).toBe(fs.realpathSync(directory));
});
it.each(["relative/app", "$(touch /tmp/not-executed)", "bad\0path"])(
  "rejects invalid project directory %s",
  (directory) => {
    expect(() =>
      resolveMcpWorkingDirectory("shadcn-ui-registry", {
        DYAD_MCP_PROJECT_DIR: directory,
      }),
    ).toThrow();
  },
);
it("rejects files and missing directories", () => {
  const file = path.join(root, "file");
  fs.writeFileSync(file, "");
  for (const directory of [file, path.join(root, "missing")])
    expect(() =>
      resolveMcpWorkingDirectory(null, { DYAD_MCP_PROJECT_DIR: directory }),
    ).toThrow();
});
