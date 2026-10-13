#!/usr/bin/env node
/**
 * enable-native-pro.mjs — convert ALL Agent v2 (local agent) tools to run on
 * normal agents with BYO provider keys. Zero Dyad engine calls.
 *
 * Usage (repo root): node scripts/enable-native-pro.mjs
 * Idempotent: re-running after patching is a no-op.
 * Fails loudly if upstream source no longer matches (drift detection),
 * instead of silently corrupting the file.
 *
 * License note: src/pro/ is FSL-1.1-ALv2. Internal use is a Permitted
 * Purpose. Do NOT redistribute this build as a competing product.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const patches = [
  // 1) Master gate: every isDyadProEnabled call site (38 files) goes native.
  {
    file: "src/lib/schemas.ts",
    from: [
      "export function isDyadProEnabled(settings: UserSettings): boolean {",
      "  return settings.enableDyadPro === true && hasDyadProKey(settings);",
      "}",
    ].join("\n"),
    to: [
      "export function isDyadProEnabled(settings: UserSettings): boolean {",
      "  // NATIVE-PRO: all Pro-gated local features are enabled without a Dyad",
      "  // subscription. Cloud-engine routing is separately gated on an \"auto\"",
      "  // provider API key (get_model_client.ts), so with no key configured",
      "  // no request is ever routed to the Dyad engine.",
      "  return settings.enableDyadPro !== false;",
      "}",
    ].join("\n"),
  },
  // 2) Auxiliary requests (titles, summaries) never remap to the engine.
  {
    file: "src/lib/auxiliaryModel.ts",
    from: [
      'import { isDyadProEnabled, type UserSettings } from "./schemas";',
    ].join("\n"),
    to: ['import { type UserSettings } from "./schemas";'].join("\n"),
  },
  {
    file: "src/lib/auxiliaryModel.ts",
    from: [
      "export function getAuxiliarySettings(settings: UserSettings): UserSettings {",
      '  return settings.proModelUsage === "api-key" && isDyadProEnabled(settings)',
      '    ? { ...settings, proModelUsage: "pro" }',
      "    : settings;",
      "}",
    ].join("\n"),
    to: [
      "export function getAuxiliarySettings(settings: UserSettings): UserSettings {",
      "  // NATIVE-PRO: never remap auxiliary requests to the Dyad engine.",
      "  // Auxiliary work (titles, summaries) always uses BYO providers.",
      "  return settings;",
      "}",
    ].join("\n"),
  },
  // 3) explore_code subagent: any provider key instead of the engine key.
  {
    file: "src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts",
    from: [
      "function assertDyadValueAvailable(settings: UserSettings): void {",
      "  if (!settings.enableDyadPro || !settings.providerSettings?.auto?.apiKey) {",
      "    throw new DyadError(",
      "      \"explore_code sub-agent requires Dyad Pro with an auto provider API key\",",
      "      DyadErrorKind.Precondition,",
      "    );",
      "  }",
      "}",
    ].join("\n"),
    to: [
      "function assertDyadValueAvailable(settings: UserSettings): void {",
      "  // NATIVE-PRO: the explore_code sub-agent runs on any configured provider",
      "  // key (getModelClient routes to BYO providers); the Dyad engine",
      "  // credential is no longer required.",
      "  const hasAnyProviderKey = Object.values(",
      "    settings.providerSettings ?? {},",
      "  ).some((provider) => !!provider?.apiKey?.value);",
      "  if (!hasAnyProviderKey) {",
      "    throw new DyadError(",
      "      \"explore_code sub-agent requires a configured provider API key\",",
      "      DyadErrorKind.Precondition,",
      "    );",
      "  }",
      "}",
    ].join("\n"),
  },
];

let applied = 0;
for (const { file, from, to } of patches) {
  const abs = path.join(root, file);
  const src = readFileSync(abs, "utf8");
  if (src.includes(to)) {
    console.log(`already patched: ${file}`);
    continue;
  }
  if (!src.includes(from)) {
    console.error(
      `FAIL: expected source not found in ${file}. ` +
        "Upstream has changed — update this script before re-applying.",
    );
    process.exit(1);
  }
  writeFileSync(abs, src.replace(from, to));
  console.log(`patched: ${file}`);
  applied += 1;
}
console.log(`done (${applied} patch(es) applied).`);
