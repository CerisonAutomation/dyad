import { describe, expect, test } from "vitest";

import { addTaggerRule, isNextComponentTaggerUpgradeNeeded } from "./next_config_patcher";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOADER = "@dyad-sh/nextjs-webpack-component-tagger";

function tmpApp(configName: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dyad-next-"));
  writeFileSync(join(dir, configName), content, "utf-8");
  return dir;
}

describe("addTaggerRule", () => {
  test("injects the loader into an existing webpack callback", () => {
    const input = `const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {};
    return config;
  },
};
module.exports = nextConfig;
`;
    const out = addTaggerRule(input);

    expect(out).toContain(LOADER);
    // The rule must be inside the callback, before the return.
    const ruleAt = out.indexOf(LOADER);
    const returnAt = out.indexOf("return config");
    expect(ruleAt).toBeGreaterThan(-1);
    expect(ruleAt).toBeLessThan(returnAt);
    // The rest of the file survives.
    expect(out).toContain("reactStrictMode: true");
    expect(out).toContain("config.resolve.alias = {};");
  });

  test("is idempotent", () => {
    const input = `module.exports = {
  webpack: (config) => {
    return config;
  },
};`;
    const once = addTaggerRule(input);
    const twice = addTaggerRule(once);
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(LOADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
  });

  test("handles a function-declaration form", () => {
    const input = `module.exports = {
  webpack(config) {
    return config;
  },
};`;
    expect(addTaggerRule(input)).toContain(LOADER);
  });

  test("refuses rather than guessing when there is no webpack callback", () => {
    const input = `module.exports = { reactStrictMode: true };`;
    // A wrong guess would silently break the user's build config.
    expect(() => addTaggerRule(input)).toThrow();
  });

  test("leaves an already-tagged config alone", () => {
    const input = `module.exports = {
  webpack: (config) => {
    config.module.rules.push({ use: { loader: "${LOADER}" } });
    return config;
  },
};`;
    expect(addTaggerRule(input)).toBe(input);
  });
});

describe("isNextComponentTaggerUpgradeNeeded", () => {
  test("true for an untagged Next.js config", () => {
    const dir = tmpApp(
      "next.config.js",
      `module.exports = { webpack: (config) => { return config; } };`,
    );
    expect(isNextComponentTaggerUpgradeNeeded(dir)).toBe(true);
  });

  test("true even with no webpack callback yet", () => {
    // Most hand-written next.config files only set headers/output. Requiring an
    // existing callback meant the upgrade was never offered for those apps.
    const dir = tmpApp(
      "next.config.ts",
      `const nextConfig: NextConfig = { output: "standalone" };\nexport default nextConfig;`,
    );
    expect(isNextComponentTaggerUpgradeNeeded(dir)).toBe(true);
  });

  test("adds a webpack callback when the config has none", () => {
    const input = `const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
};

export default nextConfig;`;
    const out = addTaggerRule(input);
    expect(out).toContain(LOADER);
    expect(out).toContain("webpack(config) {");
    // Everything that was there before survives, and the object still closes.
    expect(out).toContain('output: "standalone"');
    expect(out).toContain("export default nextConfig;");
    // Balanced braces.
    const opens = (out.match(/\{/g) ?? []).length;
    const closes = (out.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  test("false once the loader is present", () => {
    const dir = tmpApp(
      "next.config.js",
      `module.exports = { webpack: (config) => { config.module.rules.push({ use: { loader: "${LOADER}" } }); return config; } };`,
    );
    expect(isNextComponentTaggerUpgradeNeeded(dir)).toBe(false);
  });

  test("false for a Vite app", () => {
    const dir = tmpApp(
      "vite.config.ts",
      `import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };`,
    );
    expect(isNextComponentTaggerUpgradeNeeded(dir)).toBe(false);
  });

  test("finds next.config.mjs as well as .js", () => {
    const dir = tmpApp("next.config.mjs", `export default { webpack: (c) => c };`);
    expect(isNextComponentTaggerUpgradeNeeded(dir)).toBe(true);
  });
});
