import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({
  scope: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: (...args: unknown[]) => logMocks.scope(...(args as [])),
  },
}));

import {
  decideScore,
  decideYesNo,
  isDiffRootCauseFix,
  isPromptRewriteSafe,
  parseJevOutput,
  resetJevCommandCache,
  resolveJevCommand,
} from "./decision";

// Captured verbatim from the `jev` CLI (0.3.2).
const YES_JSON = `{"model": "jev-1.13.0", "id": null, "provider": "typesafe", "answer": {"type": "noul", "noul": 0.65, "yes": true}, "usage": {"input_tokens": 272, "output_tokens": 20}}`;
const NO_JSON = `{"model": "jev-1.13.0", "id": null, "provider": "typesafe", "answer": {"type": "noul", "noul": 0.4, "yes": false}, "usage": {"input_tokens": 299, "output_tokens": 20}}`;
const SCORE_JSON = `{"model": "jev-1.13.0", "id": null, "provider": "typesafe", "answer": {"type": "score", "score": 3.63, "confidence": 0.0, "legend": {"0": "1", "1": "2", "2": "3", "3": "4", "4": "5", "5": "6", "6": "7", "7": "8", "8": "9", "9": "10"}, "probabilities": {"0": 0.34, "1": 0.04, "2": 0.03, "3": 0.03, "4": 0.23, "5": 0.05, "6": 0.04, "7": 0.03, "8": 0.04, "9": 0.17}, "label": "1", "value": 4.63}, "usage": {"input_tokens": 339, "output_tokens": 17}}`;

const originalEnvPath = process.env.JEV_CLI_PATH;

beforeEach(() => {
  resetJevCommandCache();
});

afterEach(() => {
  if (originalEnvPath === undefined) {
    delete process.env.JEV_CLI_PATH;
  } else {
    process.env.JEV_CLI_PATH = originalEnvPath;
  }
  resetJevCommandCache();
});

describe("parseJevOutput", () => {
  it("parses the JSON output of `jev yes`", () => {
    expect(parseJevOutput(YES_JSON, "yes")).toEqual({
      ok: true,
      score: 6.5,
      unavailable: false,
    });
    expect(parseJevOutput(NO_JSON, "yes")).toEqual({
      ok: false,
      score: 4,
      unavailable: false,
    });
  });

  it("parses the plain output of `jev yes`", () => {
    expect(parseJevOutput("yes\t0.97", "yes")).toEqual({
      ok: true,
      score: 9.7,
      unavailable: false,
    });
    expect(parseJevOutput("no\t0.02", "yes")).toEqual({
      ok: false,
      score: 0.2,
      unavailable: false,
    });
  });

  it("parses the JSON output of `jev score`", () => {
    expect(parseJevOutput(SCORE_JSON, "score")).toEqual({
      ok: true,
      score: 4.6,
      unavailable: false,
    });
  });

  it("parses the plain output of `jev score`", () => {
    expect(parseJevOutput("8.40\t8", "score")).toEqual({
      ok: true,
      score: 8.4,
      unavailable: false,
    });
  });

  it("falls back to the raw score when the offset value is missing", () => {
    const raw = `{"answer": {"type": "score", "score": 7.5}}`;
    expect(parseJevOutput(raw, "score")).toEqual({
      ok: true,
      score: 7.5,
      unavailable: false,
    });
  });

  it("derives the verdict from the probability when `yes` is missing", () => {
    const raw = `{"answer": {"type": "noul", "noul": 0.8}}`;
    expect(parseJevOutput(raw, "yes")).toEqual({
      ok: true,
      score: 8,
      unavailable: false,
    });
  });

  it("reports unusable output as unavailable", () => {
    for (const raw of [
      "",
      "   ",
      "not json at all",
      "jev: 未找到 TYPESAFE_API_KEY",
      `{"answer": {"type": "noul"}}`,
      `{"answer": {"type": "score"}}`,
      "{}",
    ]) {
      expect(parseJevOutput(raw, "yes")).toEqual({
        ok: false,
        score: 0,
        unavailable: true,
      });
      expect(parseJevOutput(raw, "score")).toEqual({
        ok: false,
        score: 0,
        unavailable: true,
      });
    }
  });

  it("rejects a yes verdict without a probability", () => {
    expect(parseJevOutput("yes", "yes")).toEqual({
      ok: false,
      score: 0,
      unavailable: true,
    });
  });

  it("clamps out-of-range numbers", () => {
    expect(parseJevOutput("yes\t4.5", "yes").score).toBe(10);
    expect(parseJevOutput("yes\t-2", "yes").score).toBe(0);
    expect(parseJevOutput("99.9\t9", "score").score).toBe(10);
  });
});

describe("resolveJevCommand", () => {
  it("prefers JEV_CLI_PATH", async () => {
    process.env.JEV_CLI_PATH = "/opt/custom/jev";
    const command = await resolveJevCommand();
    expect(command).toEqual({ command: "/opt/custom/jev", args: [] });
  });

  it("falls back to a jev on PATH or to npx when JEV_CLI_PATH is unset", async () => {
    delete process.env.JEV_CLI_PATH;
    const command = await resolveJevCommand();
    expect(command).toBeDefined();
    if (command?.command === "npx") {
      expect(command.args).toEqual(["--no-install", "jev"]);
    } else {
      expect(command?.command).toMatch(/jev$/);
      expect(command?.args).toEqual([]);
    }
  });
});

describe("fail-closed behaviour", () => {
  it("returns unavailable when the CLI cannot be launched", async () => {
    process.env.JEV_CLI_PATH = "/definitely/not/here/jev";
    const decision = await decideYesNo("some state", { timeoutMs: 1000 });
    expect(decision).toEqual({ ok: false, score: 0, unavailable: true });
  });

  it("returns unavailable for a score when the CLI cannot be launched", async () => {
    process.env.JEV_CLI_PATH = "/definitely/not/here/jev";
    const decision = await decideScore("some state", { timeoutMs: 1000 });
    expect(decision).toEqual({ score: 0, unavailable: true });
  });

  it("keeps the gate defaults when the CLI is unavailable", async () => {
    process.env.JEV_CLI_PATH = "/definitely/not/here/jev";
    const diff = await isDiffRootCauseFix("diff", { timeoutMs: 1000 });
    expect(diff.ok).toBe(false);
    expect(diff.unavailable).toBe(true);

    const prompt = await isPromptRewriteSafe("prompt", { timeoutMs: 1000 });
    expect(prompt.ok).toBe(false);
    expect(prompt.unavailable).toBe(true);
  });
});
