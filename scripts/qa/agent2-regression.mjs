import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const providerTargets = pkg.scripts["qa:provider-only"].split(/\s+/).slice(2);
const additionalTargets = [
  "src/components/settings/ProviderSettingsPage.test.tsx",
  "src/components/SubscriptionStatusBanner.test.tsx",
  "src/components/chat/FreeAgentQuotaBanner.test.tsx",
  "src/ipc/utils/opencode_headers.test.ts",
  "src/ipc/utils/preview_browser_driver.test.ts",
  "src/ipc/utils/preview_dom.test.ts",
  "src/pro/main/ipc/handlers/local_agent/tool_loop_guard.test.ts",
  "src/pro/main/ipc/handlers/local_agent/tools/preview.test.ts",
  "src/components/RuntimeModeSelector.test.ts",
  "src/ipc/services/codex_subscription_usage.test.ts",
  "src/components/chat/ImprovePromptButton.test.tsx",
  "src/ipc/handlers/prompt_improvement_handlers.test.ts",
  "src/prompts/coding_quality_contract.test.ts",
  "src/prompts/framework_reference_prompt.test.ts",
  "src/pro/main/ipc/handlers/local_agent/tools/read_guide.spec.ts",
  "src/browser_preview/adapter.test.ts",
  "src/ipc/contracts/core.test.ts",
  "src/pages/home.test.tsx",
  "src/components/ModelPicker.test.tsx",
  "src/components/chat/HomeChatInput.test.tsx",
  "src/local_tts/client.test.ts",
  "src/local_tts/text.test.ts",
  "src/lib/modelCatalogPolicy.test.ts",
  "src/ipc/shared/openrouter_model_discovery.test.ts",
  "src/ipc/shared/remote_language_model_catalog.test.ts",
  "src/pro/main/ipc/handlers/local_agent/goal_runtime_budget.test.ts",
  "src/ipc/utils/public_web_fetch.test.ts",
  "src/pro/main/ipc/handlers/local_agent/tools/local_web_tools.test.ts",
  "src/lib/dependency_security.test.ts",
];
// Vitest sees each target once; no shell parsing, implicit downloads, or servers.
const targets = [...new Set([...providerTargets, ...additionalTargets])];
const workers = Number(process.env.AGENT2_QA_WORKERS ?? "1");
if (!Number.isInteger(workers) || workers < 1 || workers > 4) {
  throw new Error("AGENT2_QA_WORKERS must be an integer from 1 to 4");
}
console.log(
  `Agent2 regression: ${targets.length} targeted suites (not whole-app coverage)`,
);
const result = spawnSync(
  process.execPath,
  [
    new URL("../../node_modules/vitest/vitest.mjs", import.meta.url).pathname,
    "run",
    "--maxWorkers",
    String(workers),
    ...targets,
  ],
  { stdio: "inherit" },
);
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
