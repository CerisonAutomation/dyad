import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

import { loadLedger, recordToolFailure } from "./ledger";
import {
  classSeverity,
  computeFixScore,
  mergeOracleDiagnoses,
  runRalphLoop,
  type CriticVerdict,
  type OracleDiagnosis,
  type RalphPorts,
  type VerificationEvidence,
} from "./ralph";

const tempDirs: string[] = [];

async function makeAppPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-ralph-"));
  tempDirs.push(dir);
  return dir;
}

const AGREEING_ORACLES: OracleDiagnosis[] = [
  { oracleId: "a", rootCause: "the path is resolved twice", confidence: 9 },
  { oracleId: "b", rootCause: "the path is resolved twice", confidence: 8 },
  { oracleId: "c", rootCause: "the path is resolved twice", confidence: 9 },
];

const PASSING_EVIDENCE: VerificationEvidence[] = [
  { command: "npm run ts", exitCode: 0, outputExcerpt: "ok", passed: true },
];

const FAILING_EVIDENCE: VerificationEvidence[] = [
  {
    command: "npm run ts",
    exitCode: 2,
    outputExcerpt: "error TS",
    passed: false,
  },
];

function makePorts(overrides: Partial<RalphPorts> = {}): RalphPorts {
  return {
    diagnose: vi.fn(async () => AGREEING_ORACLES),
    plan: vi.fn(async () => ({
      summary: "resolve the path once",
      preventionRule: {
        title: "Resolve once",
        rule: "Never resolve a path twice.",
      },
    })),
    apply: vi.fn(async () => {}),
    verify: vi.fn(async () => PASSING_EVIDENCE),
    critique: vi.fn(
      async (): Promise<CriticVerdict> => ({ verdict: "approve", reasons: [] }),
    ),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("mergeOracleDiagnoses", () => {
  it("accepts a unanimous verdict", () => {
    const verdict = mergeOracleDiagnoses(AGREEING_ORACLES);
    expect(verdict.agreed).toBe(true);
    expect(verdict.agreeing).toBe(3);
    expect(verdict.dissenting).toBe(0);
    expect(verdict.score).toBeGreaterThanOrEqual(7);
  });

  it("accepts a confident 2-of-3 majority", () => {
    const verdict = mergeOracleDiagnoses([
      AGREEING_ORACLES[0],
      AGREEING_ORACLES[1],
      { oracleId: "c", rootCause: "the timeout is too short", confidence: 1 },
    ]);
    expect(verdict.agreeing).toBe(2);
    expect(verdict.dissenting).toBe(1);
    expect(verdict.agreed).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(7);
  });

  it("never lets a single oracle reach the gate", () => {
    const verdict = mergeOracleDiagnoses([
      {
        oracleId: "a",
        rootCause: "the path is resolved twice",
        confidence: 10,
      },
      { oracleId: "b", rootCause: "something else entirely", confidence: 2 },
      { oracleId: "c", rootCause: "a third theory", confidence: 2 },
    ]);
    expect(verdict.agreeing).toBe(1);
    expect(verdict.agreed).toBe(false);
  });

  it("rejects a majority that a confident dissenter outweighs", () => {
    const verdict = mergeOracleDiagnoses([
      { oracleId: "a", rootCause: "the path is resolved twice", confidence: 7 },
      { oracleId: "b", rootCause: "the path is resolved twice", confidence: 7 },
      { oracleId: "c", rootCause: "the timeout is too short", confidence: 9 },
    ]);
    expect(verdict.agreeing).toBe(2);
    expect(verdict.score).toBeLessThan(7);
    expect(verdict.agreed).toBe(false);
  });

  it("returns no consensus for an empty or abstaining set", () => {
    expect(mergeOracleDiagnoses([]).agreed).toBe(false);
    expect(
      mergeOracleDiagnoses([{ oracleId: "a", rootCause: "  ", confidence: 10 }])
        .agreed,
    ).toBe(false);
  });
});

describe("computeFixScore", () => {
  it("is zero when the verification failed", () => {
    expect(computeFixScore(false, { verdict: "approve", reasons: [] })).toBe(0);
  });

  it("is zero on a veto", () => {
    expect(
      computeFixScore(true, { verdict: "veto", reasons: ["out of scope"] }),
    ).toBe(0);
  });

  it("uses the critic score for an approval", () => {
    expect(
      computeFixScore(true, { verdict: "approve", reasons: [], score: 9 }),
    ).toBe(9);
    expect(
      computeFixScore(true, { verdict: "approve", reasons: [], score: 5 }),
    ).toBe(5);
  });

  it("defaults an approval to a solid score", () => {
    expect(computeFixScore(true, { verdict: "approve", reasons: [] })).toBe(8);
  });
});

describe("classSeverity", () => {
  it("maps occurrences onto a 0-10 scale", () => {
    expect(classSeverity(0)).toBe(0);
    expect(classSeverity(3)).toBe(3);
    expect(classSeverity(50)).toBe(10);
  });
});

describe("runRalphLoop", () => {
  it("finalises when every gate passes", async () => {
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts(),
    });
    expect(result.finalised).toBe(true);
    expect(result.needsHuman).toBe(false);
    expect(result.stopReason).toBe("finalised");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0].fixScore).toBe(8);
  });

  it("runs the full loop when the verification fails", async () => {
    const verify = vi.fn(async () => FAILING_EVIDENCE);
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ verify }),
    });
    expect(result.finalised).toBe(false);
    expect(result.needsHuman).toBe(true);
    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.iterations).toHaveLength(5);
    expect(result.iterations[0].fixScore).toBe(0);
    expect(result.iterations[0].verificationPassed).toBe(false);
  });

  it("keeps looping after a veto and finalises later", async () => {
    let call = 0;
    const critique = vi.fn(async (): Promise<CriticVerdict> => {
      call += 1;
      return call === 1
        ? { verdict: "veto", reasons: ["unrelated refactor"] }
        : { verdict: "approve", reasons: [] };
    });
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ critique }),
    });
    expect(result.finalised).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0].finalised).toBe(false);
    expect(result.iterations[1].finalised).toBe(true);
  });

  it("stops when the oracles do not agree", async () => {
    const diagnose = vi.fn(async () => [
      { oracleId: "a", rootCause: "one theory", confidence: 9 },
      { oracleId: "b", rootCause: "another theory", confidence: 9 },
      { oracleId: "c", rootCause: "a third theory", confidence: 9 },
    ]);
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ diagnose }),
    });
    expect(result.finalised).toBe(false);
    expect(result.stopReason).toBe("no_consensus");
    expect(result.iterations).toHaveLength(1);
  });

  it("stops early when the continuation gate says stop", async () => {
    const shouldContinue = vi.fn(async () => false);
    const critique = vi.fn(
      async (): Promise<CriticVerdict> => ({
        verdict: "veto",
        reasons: ["not yet"],
      }),
    );
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ critique, shouldContinue }),
    });
    expect(result.finalised).toBe(false);
    expect(result.stopReason).toBe("stopped");
    expect(result.iterations).toHaveLength(1);
  });

  it("never exceeds the iteration budget", async () => {
    const critique = vi.fn(
      async (): Promise<CriticVerdict> => ({
        verdict: "veto",
        reasons: ["not yet"],
      }),
    );
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ critique }),
      maxIterations: 99,
    });
    expect(result.iterations).toHaveLength(5);
  });

  it("survives a throwing step and records the error as evidence", async () => {
    const apply = vi.fn(async () => {
      throw new Error("apply blew up");
    });
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ apply }),
    });
    expect(result.finalised).toBe(false);
    expect(result.iterations[0].error).toContain("apply blew up");
  });

  it("marks the ledger entry as needs_human when the budget is exhausted", async () => {
    const appPath = await makeAppPath();
    const recorded = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: new Set<string>(),
    });
    if (!recorded) throw new Error("expected the failure to be recorded");
    const { signature } = recorded;
    const critique = vi.fn(
      async (): Promise<CriticVerdict> => ({
        verdict: "veto",
        reasons: ["not yet"],
      }),
    );
    const result = await runRalphLoop({
      signature,
      appPath,
      ports: makePorts({ critique }),
    });
    expect(result.needsHuman).toBe(true);
    const ledger = await loadLedger(appPath);
    expect(ledger.entries[signature].status).toBe("needs_human");
  });

  it("stops when the fast decision layer rejects the diagnosis", async () => {
    const isDiagnosisPlausible = vi.fn(async () => ({
      ok: false,
      score: 2.5,
    }));
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ isDiagnosisPlausible }),
    });
    expect(result.finalised).toBe(false);
    expect(result.stopReason).toBe("diagnosis_rejected");
    expect(result.iterations[0].diagnosisScore).toBe(2.5);
  });

  it("continues when the fast decision layer accepts the diagnosis", async () => {
    const isDiagnosisPlausible = vi.fn(async () => ({ ok: true, score: 8 }));
    const result = await runRalphLoop({
      signature: "sig-1",
      ports: makePorts({ isDiagnosisPlausible }),
    });
    expect(result.finalised).toBe(true);
    expect(result.iterations[0].diagnosisScore).toBe(8);
  });

  it("reports the class severity from the ledger occurrences", async () => {
    const appPath = await makeAppPath();
    const recorded = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: new Set<string>(),
    });
    if (!recorded) throw new Error("expected the failure to be recorded");
    const { signature } = recorded;
    await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: new Set<string>(),
    });
    const result = await runRalphLoop({
      signature,
      appPath,
      ports: makePorts(),
    });
    expect(result.classSeverity).toBe(2);
  });

  it("marks the ledger entry as handled when the loop finalises", async () => {
    const appPath = await makeAppPath();
    const recorded = await recordToolFailure({
      appPath,
      toolName: "read_file",
      args: { path: "src/a.ts" },
      error: new Error("boom"),
      alreadyHandled: new Set<string>(),
    });
    if (!recorded) throw new Error("expected the failure to be recorded");
    const { signature } = recorded;
    const result = await runRalphLoop({
      signature,
      appPath,
      ports: makePorts(),
    });
    expect(result.finalised).toBe(true);
    const ledger = await loadLedger(appPath);
    expect(ledger.entries[signature].status).toBe("handled");
  });
});
