import ts from "typescript";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";

// Inspect registration structurally; do not execute downloaded code or probe user accounts.
const root = resolve(import.meta.dirname, "../..");
process.chdir(root);
const registry = "src/pro/main/ipc/handlers/local_agent/tool_definitions.ts";
const ast = ts.createSourceFile(
  registry,
  readFileSync(registry, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const imports = new Map();
let symbols = [];
for (const node of ast.statements) {
  if (
    ts.isImportDeclaration(node) &&
    node.importClause?.namedBindings &&
    ts.isNamedImports(node.importClause.namedBindings)
  ) {
    for (const item of node.importClause.namedBindings.elements)
      imports.set(
        item.name.text,
        resolve(dirname(registry), node.moduleSpecifier.text + ".ts"),
      );
  }
  if (ts.isVariableStatement(node))
    for (const decl of node.declarationList.declarations) {
      if (
        decl.name.getText(ast) === "TOOL_DEFINITIONS" &&
        decl.initializer &&
        ts.isArrayLiteralExpression(decl.initializer)
      )
        symbols = decl.initializer.elements.map((item) => item.getText(ast));
    }
}
if (!symbols.length)
  throw new Error(
    "No TOOL_DEFINITIONS registry found; audit cannot silently pass",
  );
const sourceRows = symbols.map((symbol) => {
  const file = imports.get(symbol);
  if (!file || !existsSync(file))
    throw new Error(`Cannot resolve registered tool ${symbol}`);
  const text = readFileSync(file, "utf8");
  const stem = file.slice(0, -3);
  return {
    symbol,
    source: file.slice(root.length + 1),
    siblingTests: [".test.ts", ".spec.ts"]
      .map((ext) => stem + ext)
      .filter(existsSync)
      .map((p) => p.slice(root.length + 1)),
    legacyEngineCallInSource: /\bengineFetch\s*\(/.test(text),
  };
});
const outputDir = resolve(
  process.env.AGENT2_TOOL_AUDIT_DIR ?? "node_modules/.cache/tool-audit",
);
mkdirSync(outputDir, { recursive: true });
writeFileSync(
  resolve(outputDir, "sources.json"),
  JSON.stringify(
    {
      scope:
        "Registered tool source files; sibling presence is not execution coverage",
      tools: sourceRows,
    },
    null,
    2,
  ) + "\n",
);
const toolDir = "src/pro/main/ipc/handlers/local_agent/tools";
const targets = [
  "src/ipc/utils/subscription_catalog_routing.test.ts",
  "src/ipc/utils/codex_subscription_image.test.ts",
  "src/ipc/utils/provider_image_generation.test.ts",
  "src/ipc/services/image_generation_service.test.ts",
  "src/components/settings/ImageGenerationSettings.test.tsx",
  "src/components/ImageGeneratorDialog.test.tsx",
  "src/ipc/utils/ripgrep_utils.test.ts",
  "src/pro/main/ipc/handlers/local_agent/tool_inventory.test.ts",
  "src/pro/main/ipc/handlers/local_agent/tool_definitions.test.ts",
  ...readdirSync(toolDir)
    .filter((name) => /\.(test|spec)\.ts$/.test(name))
    .map((name) => `${toolDir}/${name}`),
];
console.log(
  `Tool audit: ${symbols.length} registered definitions; ${targets.length} focused test files, one worker`,
);
console.log(
  `Evidence: ${outputDir}; external services/native desktop are not automatically certified`,
);
// Use explicitly installed host tools for this development audit. Packaged
// Git/ripgrep distribution remains a separate release verification requirement.
const env = { ...process.env };
if (process.platform === "linux") {
  const git = spawnSync("which", ["git"], { encoding: "utf8" });
  const execPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  const rg = spawnSync("which", ["rg"], { encoding: "utf8" });
  if (git.status !== 0 || execPath.status !== 0 || rg.status !== 0)
    throw new Error(
      "Tool audit requires installed git and ripgrep; no automatic downloads or fake binaries",
    );
  env.LOCAL_GIT_DIRECTORY = resolve(dirname(git.stdout.trim()), "..");
  env.GIT_EXEC_PATH = execPath.stdout.trim();
  env.DYAD_DEV_RIPGREP_EXECUTABLE = rg.stdout.trim();
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config=scripts/qa/vitest.tool-audit.config.mts",
    "--maxWorkers=1",
    ...targets,
  ],
  {
    stdio: "inherit",
    timeout: 120_000,
    env: {
      ...env,
      AGENT2_TOOL_INVENTORY_OUTPUT: resolve(outputDir, "inventory.json"),
    },
  },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
