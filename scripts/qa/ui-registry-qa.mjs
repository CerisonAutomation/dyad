import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const checks = [
  ["scripts/setup-ui-registries.mjs", "--check"],
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config=scripts/qa/vitest.tool-audit.config.mts",
    "--maxWorkers=1",
    "src/__tests__/ui_registry_setup.test.ts",
    "src/ipc/utils/mcp_working_directory.test.ts",
    "src/ipc/utils/mcp_manager.test.ts",
    "src/ipc/shared/builtin_mcp_catalog.test.ts",
    "src/pro/main/ipc/handlers/local_agent/tools/read_guide.spec.ts",
    "src/prompts/framework_reference_prompt.test.ts",
    "src/prompts/local_agent_prompt.test.ts",
  ],
  ["scripts/qa/ui-registry-mcp-smoke.mjs"],
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    timeout: 60000,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
