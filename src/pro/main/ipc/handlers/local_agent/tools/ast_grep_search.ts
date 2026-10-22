import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import log from "electron-log/main";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { ToolDefinition } from "./types";

const execFileAsync = promisify(execFile);
const logger = log.scope("ast_grep_search");

const MAX_OUTPUT_CHARS = 40_000;
const MAX_MATCHES = 100;
const TIMEOUT_MS = 30_000;

/** Languages ast-grep parses out of the box. Anything else needs a rule config. */
const SUPPORTED_LANGUAGES = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "cs",
  "php",
  "ruby",
  "rust",
  "html",
  "css",
  "json",
  "yaml",
  "bash",
] as const;

const astGrepSearchSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Structural search pattern written as ordinary code with $METAVARIABLES, " +
        "e.g. 'function $NAME($$$ARGS) { $$$BODY }' or " +
        "'await $PROMISE' or 'console.log($$$)'. Metavariables match any node; " +
        "$$$ matches any sequence of nodes. Required unless `ruleFile` is set.",
    ),
  language: z
    .string()
    .optional()
    .describe(
      "Language to parse. One of: " +
        SUPPORTED_LANGUAGES.join(", ") +
        ". Omit to let ast-grep infer from each file's extension.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Directory or file to search, relative to the app root. Defaults to the whole app.",
    ),
  ruleFile: z
    .string()
    .optional()
    .describe(
      "Path to an ast-grep YAML rule file for complex queries (has/inside/pattern " +
        "combinators). Mutually exclusive with an inline pattern.",
    ),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Lines of surrounding context to show. Defaults to 0."),
});

const DESCRIPTION = `Search the codebase by syntax structure rather than text, using ast-grep (tree-sitter based AST matching).

### When to use this
- Find every call to a function regardless of the variable name, e.g. pattern 'await $FUNC($$$)'
- Find a code SHAPE anywhere it occurs, e.g. 'try { $$$ } catch ($$$) { $$$ }'
- Find deprecated or legacy API usage structurally, e.g. '$X.useEffect(() => { $$$ }, [])'
- Find missing error handling, un-awaited promises, or any repeated construct

### When NOT to use this
- Exact string or symbol lookups — use \`grep\`, which is faster
- Reading a file you already know — use \`read_file\`

### Example
pattern: "useState<$T>($INIT)"  finds every useState generic instantiation
pattern: "$OBJ.fetch($$$)"      finds every .fetch call regardless of receiver name
pattern: "export default $X"    finds every default export
`;

export const astGrepSearchTool: ToolDefinition = {
  name: "ast_grep_search",
  description: DESCRIPTION,
  inputSchema: astGrepSearchSchema,
  defaultConsent: "always",
  modifiesState: false,
  getConsentPreview: (args) =>
    `AST-search for ${args.pattern ?? args.ruleFile ?? "structural pattern"}`,
  execute: async (args, ctx) => {
    const pattern = args.pattern?.trim() ? args.pattern : undefined;
    const ruleFile = args.ruleFile?.trim() ? args.ruleFile : undefined;
    if (!pattern && !ruleFile) {
      throw new DyadError(
        "ast_grep_search needs either an inline `pattern` or a `ruleFile` path.",
        DyadErrorKind.Validation,
      );
    }

    const target = args.path ? args.path : ".";
    const absTarget = resolveAppRelativePath(ctx.appPath, args.path);

    const argv: string[] = ["run"];
    if (ruleFile) {
      argv.push("--rule", ruleFile);
    } else if (pattern) {
      argv.push("--pattern", pattern);
      if (args.language) argv.push("--lang", args.language);
    }
    argv.push("--json=compact");
    if (args.contextLines) {
      argv.push("--context", String(args.contextLines));
    }
    argv.push(absTarget);

    if (args.language && !SUPPORTED_LANGUAGES.includes(args.language as any)) {
      return (
        `Unsupported language "${args.language}". ast-grep parses: ` +
        `${SUPPORTED_LANGUAGES.join(", ")}. Omit \`language\` to infer from file extension.`
      );
    }

    try {
      const { stdout } = await execFileAsync("ast-grep", argv, {
        cwd: ctx.appPath,
        timeout: TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      });
      return formatMatches(stdout, target);
    } catch (error) {
      if (isDyadError(error)) {
        // Already classified (e.g. an ast-grep error payload): keep the kind
        // instead of flattening it into an untyped string.
        throw error;
      }
      const message = (error as Error).message ?? String(error);
      if (isMissingBinaryError(error, message)) {
        throw new DyadError(
          "The ast-grep binary is not available on this machine, so structural " +
            "search is disabled. Install it (for example `npm install -g " +
            "@ast-grep/cli`) and retry, or use the `grep` tool for plain-text " +
            "search.",
          DyadErrorKind.Precondition,
        );
      }
      // ast-grep exits non-zero when nothing matches, which is not a failure.
      if (
        /No valid rules|exit status 1$/.test(message) &&
        !message.includes("Error")
      )
        return `No structural matches for that pattern in ${target}.`;
      logger.warn("ast-grep search failed", error);
      // A malformed pattern is the overwhelmingly common cause, and ast-grep's
      // own message ("Multiple AST nodes are detected") does not teach the fix.
      // An invalid pattern is a usage error, not a tool fault, so say so and
      // show the shape that works.
      if (
        /Cannot parse query|Invalid|Unexpected token|error/i.test(message) &&
        !/No such file|ENOENT/i.test(message)
      ) {
        return [
          `That is not a valid ast-grep pattern. ast-grep matches syntax, so the pattern must parse as real code in the target language.`,
          ``,
          `Patterns that work:`,
          `  function $NAME($$$ARGS) { $$$BODY }   match any function`,
          `  await $PROMISE                          match any awaited call`,
          `  useState<$T>($INIT)                    match any useState generic`,
          `  export const $NAME = $VALUE            match any const export`,
          `  try { $$$A } catch ($$$E) { $$$B }      match any try/catch`,
          ``,
          `Notes: $NAME captures one node, $$$ARGS captures a sequence. A $ in a`,
          `keyword or type position (e.g. 'export $KIND $NAME') is rejected.`,
          ``,
          `Underlying error: ${message.slice(0, 400)}`,
        ].join("\n");
      }
      return `ast-grep search failed: ${message.slice(0, 2000)}`;
    }
  },
};

interface AstGrepMatch {
  text: string;
  file: string;
  range?: { start: { line: number; column: number }; end: { line: number } };
  language?: string;
  metaVariables?: {
    single?: Record<string, { text: string }>;
    multi?: Record<string, Array<{ text: string }>>;
  };
}

function formatMatches(stdout: string, target: string): string {
  if (!stdout.trim()) return `No structural matches in ${target}.`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // ast-grep emits a non-JSON diagnostic on some error paths.
    return stdout.slice(0, MAX_OUTPUT_CHARS);
  }
  if (!Array.isArray(parsed)) {
    // Only an empty list means "no matches". Any other payload is ast-grep
    // reporting a failure, and reporting it as "no matches" would hide it.
    throw new DyadError(
      `ast-grep returned an unexpected payload instead of a match list: ${stdout.slice(
        0,
        200,
      )}`,
      DyadErrorKind.External,
    );
  }
  const matches = parsed as AstGrepMatch[];
  if (matches.length === 0) {
    return `No structural matches in ${target}.`;
  }

  const truncated = matches.length > MAX_MATCHES;
  const shown = matches.slice(0, MAX_MATCHES);
  const appPath = process.cwd();
  const parts = shown.map((match, index) => {
    const line = match.range?.start?.line ?? 0;
    const column = match.range?.start?.column ?? 0;
    const file = (match.file ?? "?").replace(appPath, "").replace(/^\//, "");
    const snippet = match.text.split("\n").slice(0, 12).join("\n");
    const captured = summarizeMetaVariables(match.metaVariables);
    return [
      `${index + 1}. ${file}:${line + 1}:${column + 1}  [${match.language ?? "?"}]`,
      captured,
      snippet,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const header = `Found ${matches.length} structural match${matches.length === 1 ? "" : "es"}${truncated ? ` (showing first ${MAX_MATCHES})` : ""}:\n`;
  const body = parts.join("\n---\n");
  if (body.length <= MAX_OUTPUT_CHARS) {
    return header + body;
  }
  return (
    header +
    body.slice(0, MAX_OUTPUT_CHARS) +
    `\n\n[TRUNCATED: output exceeded ${MAX_OUTPUT_CHARS} characters. Narrow the search (a more specific pattern, language, or path) to see the rest.]`
  );
}

/**
 * Resolve a model-supplied path against the app root and refuse anything that
 * escapes it, so a tool call cannot read files outside the app.
 */
function resolveAppRelativePath(
  appPath: string,
  relativePath?: string,
): string {
  const root = path.resolve(appPath);
  if (!relativePath) {
    return root;
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new DyadError(
      `Path "${relativePath}" is outside the app directory. Use a path relative to the app root.`,
      DyadErrorKind.Validation,
    );
  }
  return resolved;
}

/**
 * True when the spawn failed because the executable does not exist (ast-grep is
 * not bundled with Dyad and has to be installed separately).
 */
function isMissingBinaryError(error: unknown, message: string): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "ENOENT" || /\bENOENT\b/.test(message);
}

function summarizeMetaVariables(
  meta: AstGrepMatch["metaVariables"],
): string | null {
  if (!meta) return null;
  const single = meta.single ?? {};
  const entries = Object.entries(single)
    .slice(0, 8)
    .map(([name, value]) => {
      const text = String(value?.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      return `${name}=${text}`;
    })
    .filter((entry) => !entry.endsWith("="));
  return entries.length ? `   bound: ${entries.join("  ")}` : null;
}
