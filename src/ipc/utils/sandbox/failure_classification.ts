import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";

/**
 * Sandbox script failures used to be reported as "This script contains
 * unsupported syntax." no matter what actually went wrong. Most failures were
 * not syntax problems at all: blocked host calls, timeouts, MCP failures and
 * runtime errors were all relabelled as syntax errors, which sent the agent
 * (and Dyad's own telemetry) chasing the wrong problem.
 *
 * This module classifies a sandbox failure into a stable shape so callers can
 * report an accurate headline and preserve the original error kind.
 */
export interface SandboxScriptFailure {
  /** The Dyad error kind to propagate (drives telemetry filtering). */
  kind: DyadErrorKind;
  /** True when the script itself is invalid (parse/validation failure). */
  isSyntaxError: boolean;
  /** One-line summary shown to the agent. */
  headline: string;
  /** Human-readable explanation with the script location suffix removed. */
  detail: string;
  /** The untouched error message from the sandbox runtime. */
  originalMessage: string;
}

const MUSTARD_ERROR_NAMES: Record<string, string> = {
  MustardParseError: "Parse",
  MustardValidationError: "Validation",
  MustardRuntimeError: "Runtime",
  MustardLimitError: "Limit",
  MustardSerializationError: "Serialization",
};

const DYAD_ERROR_KIND_VALUES = new Set<string>(
  Object.values(DyadErrorKind).map((kind) => kind.toLowerCase()),
);

const BLOCKED_HOST_CALL_KINDS = new Set<string>([
  DyadErrorKind.Precondition,
  DyadErrorKind.NotFound,
  DyadErrorKind.Conflict,
  DyadErrorKind.Auth,
  DyadErrorKind.UserCancelled,
  DyadErrorKind.RateLimited,
]);

// MustardScript appends the failing source range to runtime errors, e.g.
// "Precondition: ...\n  at <script> [0..51]". That suffix is noise for the
// agent, so it is stripped from the human-readable detail.
const SCRIPT_LOCATION_SUFFIX = /\n\s+at <script> \[[^\]]*\]/g;

const PARSE_ERROR_HINTS = [
  /unexpected token/i,
  /unexpected identifier/i,
  /unexpected end of input/i,
  /unexpected reserved word/i,
  /invalid or unexpected token/i,
];

function stripScriptLocation(message: string): string {
  return message.replace(SCRIPT_LOCATION_SUFFIX, "").trim();
}

function recoverDyadErrorKind(prefix: string): DyadErrorKind | undefined {
  const normalized = prefix.trim().toLowerCase();
  if (!normalized || !DYAD_ERROR_KIND_VALUES.has(normalized)) {
    return undefined;
  }
  return normalized as DyadErrorKind;
}

function isTimeoutMessage(message: string): boolean {
  return /timed out|timeout/i.test(message);
}

function buildRuntimeFailure(rawMessage: string): SandboxScriptFailure {
  const cleaned = stripScriptLocation(rawMessage);
  const firstLine = cleaned.split("\n")[0] ?? "";
  const separator = firstLine.indexOf(":");
  const prefix = separator > 0 ? firstLine.slice(0, separator) : "";
  const remainder =
    separator > 0 ? firstLine.slice(separator + 1).trim() : firstLine;
  const tail = cleaned.slice(firstLine.length).trim();
  const detail = [remainder, tail].filter(Boolean).join("\n");

  const recoveredKind = recoverDyadErrorKind(prefix);
  if (recoveredKind) {
    const headline = BLOCKED_HOST_CALL_KINDS.has(recoveredKind)
      ? "The sandbox blocked this host call."
      : "A sandbox host call failed.";
    return {
      kind: recoveredKind,
      isSyntaxError: false,
      headline,
      detail: detail || rawMessage,
      originalMessage: rawMessage,
    };
  }

  return {
    kind: DyadErrorKind.Validation,
    isSyntaxError: false,
    headline: "This script failed at runtime.",
    detail: detail || rawMessage,
    originalMessage: rawMessage,
  };
}

/**
 * Classifies an error thrown while running a sandbox script.
 *
 * MustardScript errors are recognised by their `name`
 * (`MustardParseError`, `MustardValidationError`, `MustardRuntimeError`,
 * `MustardLimitError`, `MustardSerializationError`). The runtime error message
 * starts with `<error name>: <message>`, which is how a host call failure
 * carries its Dyad error kind across the MustardScript boundary.
 */
export function classifySandboxScriptFailure(
  error: unknown,
): SandboxScriptFailure {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const errorName = error instanceof Error ? error.name : "";
  const mustardKind = MUSTARD_ERROR_NAMES[errorName];

  if (mustardKind === "Parse") {
    return {
      kind: DyadErrorKind.Validation,
      isSyntaxError: true,
      headline: "This script could not be parsed by the MustardScript sandbox.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  if (mustardKind === "Validation") {
    return {
      kind: DyadErrorKind.Validation,
      isSyntaxError: true,
      headline:
        "This script uses a construct that the MustardScript sandbox does not support.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  if (mustardKind === "Limit") {
    return {
      kind: DyadErrorKind.Validation,
      isSyntaxError: false,
      headline: "This script exceeded a sandbox resource limit.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  if (mustardKind === "Serialization") {
    return {
      kind: DyadErrorKind.Internal,
      isSyntaxError: false,
      headline: "The sandbox could not serialize the result of this script.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  if (mustardKind === "Runtime") {
    return buildRuntimeFailure(rawMessage);
  }

  if (isDyadError(error)) {
    const kind = error.kind;
    return {
      kind,
      isSyntaxError: false,
      headline: isTimeoutMessage(rawMessage)
        ? "This script timed out."
        : BLOCKED_HOST_CALL_KINDS.has(kind)
          ? "The sandbox blocked this host call."
          : "The sandbox script failed.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  if (isTimeoutMessage(rawMessage)) {
    return {
      kind: DyadErrorKind.External,
      isSyntaxError: false,
      headline: "This script timed out.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  if (PARSE_ERROR_HINTS.some((hint) => hint.test(rawMessage))) {
    return {
      kind: DyadErrorKind.Validation,
      isSyntaxError: true,
      headline: "This script could not be parsed by the MustardScript sandbox.",
      detail: rawMessage,
      originalMessage: rawMessage,
    };
  }

  return {
    kind: DyadErrorKind.Unknown,
    isSyntaxError: false,
    headline: "The sandbox script failed.",
    detail: rawMessage,
    originalMessage: rawMessage,
  };
}

/**
 * Builds the agent-facing failure message. It keeps the script and the
 * original error so the agent can debug itself, but the headline now says
 * what actually happened.
 */
export function formatSandboxFailureMessage(params: {
  failure: SandboxScriptFailure;
  scriptPreview: string;
}): string {
  const { failure, scriptPreview } = params;
  const lines: string[] = [failure.headline];
  if (failure.detail && failure.detail !== failure.originalMessage) {
    lines.push("", failure.detail);
  }
  lines.push(
    "",
    "Script:",
    scriptPreview,
    "",
    "Original error:",
    failure.originalMessage,
  );
  return lines.join("\n");
}
