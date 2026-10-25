import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { maxBuffer: 32 * 1024 * 1024 },
)
  .toString()
  .split("\0")
  .filter(
    (p) =>
      p &&
      /\.(?:[cm]?[jt]sx?|json|html|md|ya?ml|css|scss|svg)$/.test(p) &&
      !p.startsWith("docs/generated/") &&
      fs.existsSync(p),
  );
const codeFiles = files.filter((p) => /\.[cm]?[jt]sx?$/.test(p));
const fileSet = new Set(files);
const categories = {
  legacyBranding:
    /Dyad[\s_-]*Pro|\bBasic Agent\b|dyad-pro-|getDyadPro|proBanner|requires Pro|Pro Feature|Pro credits/gi,
  dyadEntitlement:
    /\b(?:enableDyadPro|isDyadPro\w*|dyadProEnabled|proModelUsage|isProMode|FREE_PRO_MODEL_NAME|isFreeProModel)\b/g,
  billingQuota:
    /\b(?:userBudget|UserBudget\w*|useUserBudgetInfo|freeAgentQuota\w*|freeModelQuota\w*|DyadPro\w*(?:Dialog|Banner)|ProBanner|ProModeSelector)\b|Dyad Pro|Dyad credits|dyad\.sh\/(?:pro|upgrade|account|checkout)|stripe/gi,
  hostedService:
    /engineFetch|getDyadEngineBaseUrl|createDyadEngine|(?:api|engine|helpchat|llm-gateway|telemetry)\.dyad\.sh|dyad-llm-engine|dyad\/auto\//g,
  inference:
    /\b(?:getModelClient|streamText|generateText|generateObject|createOpenAI|createAnthropic|resolveSubscriptionModel|ClaudeCodeModel|createCodexSubscriptionModel)\b/g,
  agent:
    /\b(?:subagentManager|SubagentManager|canUseExplorerSubagent|localAgentHandler|AgentContext|executionBackend|chatMode)\b/g,
  hostedAccount:
    /academy\.dyad\.sh|DYAD_ALLOW_CLOUD|DYAD_ENGINE_URL|DYAD_SUBSCRIPTION_STATUS_URL|dyad-pro-return|fetchUserInfo|transcribeWithDyadEngine|cloudSandbox|CloudSandbox/g,
  preview:
    /\b(?:AnnotatorOnlyForPro|PreviewIframe|PreviewPanel|isPreviewOpen|ScreenshotSelector)\b/g,
};
const scope = (p) =>
  /(?:^|\/)(?:__tests__|e2e-tests|fixtures|__snapshots__)(?:\/|$)|\.(?:test|spec)\.|(?:^|\/)(?:vitest|playwright)\./.test(
    p,
  )
    ? "test"
    : /^(src|shared|workers)\//.test(p)
      ? "runtime"
      : "support";
const resolveImport = (from, name) => {
  const base = name.startsWith("@/")
    ? "src/" + name.slice(2)
    : name.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(from), name))
      : null;
  if (!base) return null;
  return (
    [
      base,
      ...[
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mts",
        ".cts",
        ".mjs",
        ".json",
        "/index.ts",
        "/index.tsx",
      ].map((ext) => base + ext),
      ...(base.endsWith(".js") ? [base.replace(/\.js$/, ".ts")] : []),
    ].find((p) => fileSet.has(p)) ?? null
  );
};
const modules = [],
  edges = [],
  findings = [],
  tools = [],
  ipc = [],
  inferenceSites = [],
  urls = [],
  networkSites = [],
  registeredTools = [];
for (const file of codeFiles) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const props = (node) => {
    while (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
    )
      node = node.expression;
    return ts.isObjectLiteralExpression(node)
      ? new Map(
          node.properties
            .filter((p) => p.name)
            .map((p) => [
              p.name.getText(source).replace(/^['"]|['"]$/g, ""),
              p,
            ]),
        )
      : null;
  };
  const exports = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const name = node.moduleSpecifier.text;
      edges.push({
        from: file,
        to: resolveImport(file, name),
        specifier: name,
        line: lineOf(node),
        typeOnly:
          node.isTypeOnly === true || node.importClause?.isTypeOnly === true,
      });
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "TOOL_DEFINITIONS" &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const entry of node.initializer.elements)
        registeredTools.push({
          identifier: entry.getText(source),
          registryFile: file,
          line: lineOf(entry),
        });
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (
        /^(?:fetch|engineFetch|axios(?:\.\w+)?|.*\.(?:fetch|request)|.*\.openExternalUrl)$/.test(
          callee,
        )
      )
        networkSites.push({
          file,
          line: lineOf(node),
          callee,
          target: node.arguments[0]?.getText(source).slice(0, 400),
          scope: scope(file),
        });
      if (
        /^(?:require|import)$/.test(callee) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const name = node.arguments[0].text;
        edges.push({
          from: file,
          to: resolveImport(file, name),
          specifier: name,
          line: lineOf(node),
          dynamic: true,
        });
      }
      if (
        /^(?:createTypedHandler|createTypedEvent|ipcMain\.handle|ipcMain\.on|register.*Handlers?)$/.test(
          callee,
        )
      )
        ipc.push({
          file,
          scope: scope(file),
          line: lineOf(node),
          callee,
          channel: node.arguments[0]?.getText(source).slice(0, 220),
        });
      if (
        /^(?:streamText|generateText|generateObject|getModelClient|createOpenAI|createAnthropic|createCodexSubscriptionModel)$/.test(
          callee,
        )
      )
        inferenceSites.push({
          file,
          line: lineOf(node),
          callee,
          scope: scope(file),
        });
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const object = props(node.initializer);
      if (
        object?.has("name") &&
        (object.has("execute") || object.has("inputSchema"))
      ) {
        const values = Object.fromEntries(
          [
            "name",
            "description",
            "defaultConsent",
            "modifiesState",
            "usesEngineEndpoint",
            "isEnabled",
            "isDiscoverable",
          ]
            .filter((key) => object.has(key))
            .map((key) => {
              const prop = object.get(key);
              return [
                key,
                (prop.initializer ?? prop).getText(source).slice(0, 1000),
              ];
            }),
        );
        tools.push({
          file,
          line: lineOf(node),
          identifier: node.name.getText(source),
          ...values,
          scope: scope(file),
        });
      }
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node)) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      exports.push({
        name: node.name.text,
        kind: ts.SyntaxKind[node.kind],
        line: lineOf(node),
      });
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const match of node.text.matchAll(/https?:\/\/[^\s<>"'`)}\]]+/g)) {
        try {
          const u = new URL(match[0]);
          urls.push({
            file,
            line: lineOf(node),
            host: u.host,
            pathname: u.pathname,
            scope: scope(file),
          });
        } catch {}
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  modules.push({
    file,
    scope: scope(file),
    bytes: Buffer.byteLength(text),
    exports,
  });
  text.split("\n").forEach((line, i) => {
    for (const [category, regex] of Object.entries(categories)) {
      regex.lastIndex = 0;
      const matches = [...line.matchAll(regex)].map((m) => m[0]);
      if (matches.length)
        findings.push({
          file,
          line: i + 1,
          category,
          scope: scope(file),
          matches: [...new Set(matches)],
          evidence: line.trim().slice(0, 240),
        });
    }
  });
}
// Renderer copy and settings catalogs also live in JSON/HTML/styles, not
// only JS/TS. Inventory these separately so translation/asset residue is visible.
const textAssets = [];
const skippedTextAssets = [];
for (const file of files.filter(
  (p) =>
    !codeFiles.includes(p) && !/(?:^|\/)(?:package-lock|pnpm-lock)\./.test(p),
)) {
  if (fs.statSync(file).size > 2_000_000) {
    skippedTextAssets.push(file);
    continue;
  }
  textAssets.push({ file, scope: scope(file) });
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const [category, regex] of Object.entries(categories)) {
        regex.lastIndex = 0;
        const matches = [...line.matchAll(regex)].map((m) => m[0]);
        if (matches.length)
          findings.push({
            file,
            line: index + 1,
            category,
            scope: scope(file),
            matches: [...new Set(matches)],
            evidence: line.trim().slice(0, 240),
          });
      }
    });
}
const counts = Object.fromEntries(
  Object.keys(categories).map((category) => [
    category,
    {
      runtime: findings.filter(
        (f) => f.category === category && f.scope === "runtime",
      ).length,
      total: findings.filter((f) => f.category === category).length,
    },
  ]),
);
const toolRegistry = registeredTools.map((entry) => {
  const definition = tools.find(
    (tool) => tool.identifier === entry.identifier && tool.scope === "runtime",
  );
  return {
    ...entry,
    definition: definition
      ? {
          file: definition.file,
          line: definition.line,
          name: definition.name,
          consent: definition.defaultConsent,
          modifiesState: definition.modifiesState,
          eligibility: definition.isEnabled,
          engine: definition.usesEngineEndpoint,
        }
      : null,
    resolution: definition ? "static-object" : "needs-manual-review",
  };
});
const packageManifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
const dependencies = {
  runtime: packageManifest.dependencies,
  development: packageManifest.devDependencies,
};
const entrypoints = [
  "src/main_bootstrap.ts",
  "src/main.ts",
  "src/renderer.tsx",
  "src/preload.ts",
  ...codeFiles.filter((p) => /workers\/.*worker\.[cm]?ts$/.test(p)),
].filter((p) => fileSet.has(p));
const surfaces = Object.fromEntries(
  [
    "src/app/",
    "src/routes/",
    "src/components/",
    "src/hooks/",
    "src/first_prompt/",
    "src/prompts/",
    "src/ipc/handlers/",
    "src/ipc/services/",
    "src/ipc/utils/",
    "src/pro/main/ipc/handlers/local_agent/",
    "src/main/",
    "src/shared/",
    "shared/",
    "workers/",
  ].map((prefix) => [
    prefix,
    modules
      .filter((m) => m.scope === "runtime" && m.file.startsWith(prefix))
      .map((m) => m.file),
  ]),
);
const map = {
  schemaVersion: 1,
  coverage:
    "Static syntax/AST inventory of Git-visible JS/TS modules. Pattern findings include comments; unresolved/dynamic dispatch and runtime connectivity require execution. Not a proof of completeness or an authorization bypass.",
  counts: {
    modules: modules.length,
    imports: edges.length,
    localImports: edges.filter((e) => e.to).length,
    tools: tools.length,
    registeredTools: toolRegistry.length,
    textAssets: textAssets.length,
    networkSites: networkSites.length,
    ipc: ipc.length,
    inferenceSites: inferenceSites.length,
    categories: counts,
  },
  entrypoints,
  dependencies,
  surfaces,
  textAssets,
  skippedTextAssets,
  protectedNotices: ["LICENSE", "src/pro/LICENSE"],
  modules,
  edges,
  tools,
  toolRegistry,
  ipc,
  inferenceSites,
  networkSites,
  urls,
  findings,
};
fs.mkdirSync("docs/generated", { recursive: true });
fs.writeFileSync(
  "docs/generated/app-map.json",
  JSON.stringify(map, null, 2) + "\n",
);
const ranked = new Map();
for (const f of findings.filter(
  (f) =>
    f.scope === "runtime" &&
    [
      "dyadEntitlement",
      "billingQuota",
      "hostedService",
      "hostedAccount",
    ].includes(f.category),
))
  ranked.set(f.file, (ranked.get(f.file) ?? 0) + 1);
const summary = `# App conversion map\n\nGenerated by \`npm run audit:app\`. ${map.coverage}\n\n## Coverage\n\n- ${modules.length} modules; ${textAssets.length} text assets; ${toolRegistry.length} registered tools (all statically resolved); ${edges.length} import edges (${map.counts.localImports} statically resolved).\n- ${tools.length} tool-shaped declarations; ${ipc.length} IPC/registration call sites; ${inferenceSites.length} inference call sites (includes tests).\n- Complete evidence, module graph, URLs, tool flags and line numbers: [app-map.json](./app-map.json).\n\n## Runtime findings\n\n| Category | Matching lines |\n|---|---:|\n${Object.entries(
  counts,
)
  .map(([k, v]) => `| ${k} | ${v.runtime} |`)
  .join(
    "\n",
  )}\n\n## Highest-priority conversion surfaces\n\n| Runtime file | Billing/engine matching lines |\n|---|---:|\n${[
  ...ranked,
]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 75)
  .map(([p, n]) => `| \`${p}\` | ${n} |`)
  .join(
    "\n",
  )}\n\n## Conversion boundaries\n\n1. Renderer: model/source picker, settings, onboarding, banners, budget/quota dialogs, preview/annotation gates.\n2. Routing: settings normalization, persisted per-chat selection, inference factory, model catalog and automatic/fallback candidates.\n3. Agents/tools: root Agent2, Explorer/Implementer/testing/history subagents, safety reviewer, shell/MCP consents, engine-only tools. Preserve safety guards.\n4. IPC/services: billing admissions, credits, quota, checkout/deep links, cloud catalogs, uploads, help and auxiliary inference.\n5. Preview/runtime: Electron sessions, iframe/webview, annotator, screenshot, app lifecycle. BYOK must not gate local features behind credit balance.\n6. Compatibility: migrate old settings explicitly; do not silently bill a different provider. Claude/ChatGPT provider connections are not Dyad subscriptions.\n7. Preserve license/copyright/attribution; historical tests and migration keys are distinct from visible product UI. Do not claim legally required notices can be erased.\n\n## Registered tool inventory\n\n| Tool | Consent | Engine endpoint | Definition |\n|---|---|---|---|\n${toolRegistry.map((t) => `| ${t.definition?.name ?? t.identifier} | ${t.definition?.consent ?? "unresolved"} | ${t.definition?.engine ?? "not flagged"} | ${t.definition ? `${t.definition.file}:${t.definition.line}` : "manual review needed"} |`).join("\n")}\n\nThis is a worklist, not a statement that all hosted features have been converted or runtime-tested.\n`;
fs.writeFileSync("docs/generated/app-map.md", summary);
console.log(JSON.stringify(map.counts, null, 2));
