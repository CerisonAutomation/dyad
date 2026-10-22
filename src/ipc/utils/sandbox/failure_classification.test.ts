import { describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  classifySandboxScriptFailure,
  formatSandboxFailureMessage,
} from "@/ipc/utils/sandbox/failure_classification";

describe("classifySandboxScriptFailure", () => {
  it("reports MustardScript parse errors as a script syntax problem", () => {
    const error = Object.assign(new Error("Unexpected token"), {
      name: "MustardParseError",
    });

    const failure = classifySandboxScriptFailure(error);

    expect(failure.kind).toBe(DyadErrorKind.Validation);
    expect(failure.isSyntaxError).toBe(true);
    expect(failure.headline).toMatch(/could not be parsed/i);
    expect(failure.originalMessage).toBe("Unexpected token");
  });

  it("reports MustardScript validation errors as unsupported constructs", () => {
    const error = Object.assign(
      new Error("free reference to forbidden ambient global `process`"),
      { name: "MustardValidationError" },
    );

    const failure = classifySandboxScriptFailure(error);

    expect(failure.kind).toBe(DyadErrorKind.Validation);
    expect(failure.isSyntaxError).toBe(true);
    expect(failure.headline).toMatch(/does not support/i);
  });

  it("keeps the script timeout kind so it is reported instead of filtered", () => {
    const failure = classifySandboxScriptFailure(
      new DyadError(
        "Sandbox script timed out after 60000ms of VM execution.",
        DyadErrorKind.External,
      ),
    );

    expect(failure.kind).toBe(DyadErrorKind.External);
    expect(failure.isSyntaxError).toBe(false);
    expect(failure.headline).toMatch(/timed out/i);
  });

  it("recovers a blocked host call kind from the MustardScript runtime error", () => {
    const error = Object.assign(
      new Error(
        "Precondition: Sandbox scripts cannot access protected path: node_modules/.pnpm\n  at <script> [0..51]",
      ),
      { name: "MustardRuntimeError" },
    );

    const failure = classifySandboxScriptFailure(error);

    expect(failure.kind).toBe(DyadErrorKind.Precondition);
    expect(failure.isSyntaxError).toBe(false);
    expect(failure.detail).toContain("protected path");
    expect(failure.detail).not.toContain("at <script>");
  });

  it("recovers the kind of a host call failure surfaced through the sandbox", () => {
    const error = Object.assign(
      new Error("External: MCP tool 'search' failed\n  at <script> [10..20]"),
      { name: "MustardRuntimeError" },
    );

    const failure = classifySandboxScriptFailure(error);

    expect(failure.kind).toBe(DyadErrorKind.External);
    expect(failure.isSyntaxError).toBe(false);
    expect(failure.detail).toContain("MCP tool 'search' failed");
  });

  it("treats plain script runtime errors as script faults, not syntax errors", () => {
    const error = Object.assign(
      new Error(
        "TypeError: cannot read properties of nullish value\n  at <script> [0..22]",
      ),
      { name: "MustardRuntimeError" },
    );

    const failure = classifySandboxScriptFailure(error);

    expect(failure.kind).toBe(DyadErrorKind.Validation);
    expect(failure.isSyntaxError).toBe(false);
    expect(failure.headline).toMatch(/runtime/i);
  });

  it("detects parse failures that arrive without a MustardScript error name", () => {
    const failure = classifySandboxScriptFailure(
      new Error("Unexpected token ?."),
    );

    expect(failure.kind).toBe(DyadErrorKind.Validation);
    expect(failure.isSyntaxError).toBe(true);
  });

  it("classifies MustardScript limit errors as script faults", () => {
    const error = Object.assign(new Error("instruction budget exceeded"), {
      name: "MustardLimitError",
    });

    const failure = classifySandboxScriptFailure(error);

    expect(failure.kind).toBe(DyadErrorKind.Validation);
    expect(failure.isSyntaxError).toBe(false);
    expect(failure.headline).toMatch(/limit/i);
  });

  it("falls back to a generic failure for unknown errors", () => {
    const failure = classifySandboxScriptFailure("boom");

    expect(failure.kind).toBe(DyadErrorKind.Unknown);
    expect(failure.isSyntaxError).toBe(false);
  });
});

describe("formatSandboxFailureMessage", () => {
  it("does not blame the script syntax for non-syntax failures", () => {
    const failure = classifySandboxScriptFailure(
      new DyadError(
        "Sandbox host execution timed out after 300000ms.",
        DyadErrorKind.External,
      ),
    );

    const message = formatSandboxFailureMessage({
      failure,
      scriptPreview: "const x = 1;",
    });

    expect(message).not.toContain("unsupported syntax");
    expect(message).toContain("Script:");
    expect(message).toContain("const x = 1;");
    expect(message).toContain("Original error:");
  });

  it("explains a syntax failure and still includes the script", () => {
    const failure = classifySandboxScriptFailure(
      Object.assign(new Error("Unexpected token"), {
        name: "MustardParseError",
      }),
    );

    const message = formatSandboxFailureMessage({
      failure,
      scriptPreview: "const x = ;",
    });

    expect(message).toMatch(/could not be parsed/i);
    expect(message).toContain("Script:\nconst x = ;");
    expect(message).toContain("Original error:\nUnexpected token");
  });
});
