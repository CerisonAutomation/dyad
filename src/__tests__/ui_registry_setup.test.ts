import { spawnSync } from "node:child_process";
// @vitest-environment node
import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  mergeUiRegistries,
  setupUiRegistries,
} from "../../scripts/setup-ui-registries.mjs";
import presets from "../../shared/ui-registry-presets.json";
import { rawConfigSchema } from "shadcn/schema";
it("uses six sources, keeps shadcn built in and resolves legacy Radix Dashboardblocks", () => {
  expect(presets.registries).toHaveLength(6);
  const current = JSON.parse(fs.readFileSync("components.json", "utf8"));
  const { config } = mergeUiRegistries(current);
  expect(rawConfigSchema.safeParse(config).success).toBe(true);
  expect(config.registries).not.toHaveProperty("@shadcn");
  expect(config.registries["@dashboardblocks"]).toBe(
    "https://www.dashboardblocks.com/r/radix/{name}.json",
  );
  expect(config.registries["@origin"]).toBe(config.registries["@coss"]);
  expect(config.registries["@kibo"]).toBe(config.registries["@kibo-ui"]);
  expect(mergeUiRegistries(config)).toEqual({ config, preserved: [] });
});
it("does not overwrite custom registries, paths, CSS or theme", () => {
  const initial = {
    style: "base-nova",
    tailwind: { css: "app.css" },
    aliases: { ui: "custom" },
    registries: {
      "@magicui": "https://custom.example/{name}.json",
      "@private": {
        url: "https://private.example/{name}",
        headers: { Authorization: "${REGISTRY_TOKEN}" },
      },
    },
  };
  const { config, preserved } = mergeUiRegistries(initial);
  expect(preserved).toEqual(["@magicui"]);
  expect(config.registries["@magicui"]).toBe(initial.registries["@magicui"]);
  expect(config.tailwind).toEqual(initial.tailwind);
  expect(config.aliases).toEqual(initial.aliases);
  expect(config.registries["@private"]).toEqual(initial.registries["@private"]);
  expect(config.registries["@dashboardblocks"]).toContain("{style}");
});
it("supports check-only and atomic/idempotent application without downloading source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-registry-setup-"));
  const file = path.join(root, "components.json");
  fs.writeFileSync(file, JSON.stringify({ style: "new-york" }));
  try {
    const before = fs.readFileSync(file, "utf8");
    expect(setupUiRegistries(root, { check: true }).changed).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    setupUiRegistries(root);
    expect(setupUiRegistries(root, { check: true }).changed).toBe(false);
    expect(fs.readdirSync(root)).toEqual(["components.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it.each([null, [], { registries: [] }, { registries: null }])(
  "rejects malformed configuration",
  (config) => expect(() => mergeUiRegistries(config)).toThrow(),
);

it("rejects explicit reserved @shadcn overrides before writing invalid CLI configuration", () => {
  expect(() =>
    mergeUiRegistries({
      registries: { "@shadcn": "https://ui.shadcn.com/r/{name}.json" },
    }),
  ).toThrow("built in");
});

it("keeps the installed CLI and project MCP configuration pinned to the reviewed preset version", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const installed = JSON.parse(
    fs.readFileSync("node_modules/shadcn/package.json", "utf8"),
  );
  const mcp = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
  expect(pkg.devDependencies.shadcn).toBe(presets.cliVersion);
  expect(installed.version).toBe(presets.cliVersion);
  expect(mcp.mcpServers.shadcn.args).toContain(`shadcn@${presets.cliVersion}`);
  expect(JSON.stringify(mcp)).not.toContain("@latest");
});
it("does not print custom registry credentials in CLI check output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-registry-private-"));
  try {
    fs.writeFileSync(
      path.join(root, "components.json"),
      JSON.stringify({
        style: "new-york",
        registries: {
          "@private": {
            url: "https://private.example/{name}.json",
            headers: { Authorization: "DO-NOT-PRINT-SECRET" },
          },
        },
      }),
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/setup-ui-registries.mjs", "--cwd", root, "--check"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("@private");
    expect(result.stdout + result.stderr).not.toContain("DO-NOT-PRINT-SECRET");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
