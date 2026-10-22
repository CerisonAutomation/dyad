/**
 * The Ralph loop.
 *
 * A bounded iterative loop over one failure class:
 *
 *   DIAGNOSE -> PLAN -> APPLY -> VERIFY -> CRITIQUE -> GATE -> (next | STOP)
 *
 * Verification is evidence-based (command + exit code + output excerpt), never
 * a claim. Nothing is finalised unless the verification gate passed AND the
 * critic did not veto AND the numeric scores cleared their thresholds.
 *
 * The loop is deliberately model-agnostic: every step is an injected port, so
 * the state machine can be tested without a model, and the same machine can
 * drive sub-agents, scripts or a human.
 */

import { loadLedger, markLedgerStatus } from "./ledger";

/** Iterations allowed per failure class. */
export const RALPH_MAX_ITERATIONS = 5;

/** Independent oracle diagnoses per iteration. */
export const DEFAULT_ORACLE_COUNT = 3;

/** Minimum consensus score (0-10) to act on a diagnosis. */
export const CONSENSUS_MIN_SCORE = 7;

/** Minimum fix score (0-10) to finalise a fix. */
export const FIX_MIN_SCORE = 7;

/** Minimum number of oracles that must agree. */
export const MIN_AGREEING_ORACLES = 2;

/** Fix score used when an approving critic does not supply its own score. */
export const DEFAULT_APPROVED_FIX_SCORE = 8;

/** One independent oracle's diagnosis. */
export interface OracleDiagnosis {
  oracleId: string;
  /** The root cause this oracle believes in. */
  rootCause: string;
  /** Confidence in the diagnosis, 0-10. */
  confidence: number;
  /** Optional supporting evidence. */
  evidence?: string;
}

/** The merged verdict of all oracles. */
export interface ConsensusVerdict {
  /** The root cause the merged verdict points at. */
  rootCause: string;
  /** Score-weighted agreement, 0-10. */
  score: number;
  /** How many oracles agreed on the root cause. */
  agreeing: number;
  /** How many oracles disagreed. */
  dissenting: number;
  /** How many oracles were counted. */
  total: number;
  /** True when the agreement rule is satisfied. */
  agreed: boolean;
}

/** The plan for one iteration. */
export interface RalphPlan {
  summary: string;
  preventionRule: { title: string; rule: string };
}

/** Evidence for one verification command. */
export interface VerificationEvidence {
  command: string;
  exitCode: number;
  outputExcerpt: string;
  passed: boolean;
}

/** The critic's verdict on a diff. */
export interface CriticVerdict {
  verdict: "approve" | "veto";
  reasons: string[];
  /** Optional 0-10 confidence in the verdict. */
  score?: number;
}

/** Context handed to every port on an iteration. */
export interface RalphIterationContext {
  signature: string;
  iteration: number;
  maxIterations: number;
  consensus?: ConsensusVerdict;
  plan?: RalphPlan;
  /** Evidence collected by the previous iteration. */
  previousEvidence: VerificationEvidence[];
  /** The previous iteration's critique. */
  previousCritique?: CriticVerdict;
}

/** The injectable steps of the loop. */
export interface RalphPorts {
  diagnose(context: RalphIterationContext): Promise<OracleDiagnosis[]>;
  plan(context: RalphIterationContext): Promise<RalphPlan>;
  apply(context: RalphIterationContext): Promise<void>;
  verify(context: RalphIterationContext): Promise<VerificationEvidence[]>;
  critique(context: RalphIterationContext): Promise<CriticVerdict>;
  /**
   * Optional fast-decision verdict on the merged diagnosis. It can only
   * REJECT a diagnosis, never accept one on its own, so a missing port leaves
   * the consensus rule in charge.
   */
  isDiagnosisPlausible?(context: RalphIterationContext): Promise<{
    ok: boolean;
    score: number;
  }>;
  /**
   * Optional extra stop signal. It can only end the loop EARLIER: the
   * iteration budget stays the hard bound.
   */
  shouldContinue?(context: RalphIterationContext): Promise<boolean>;
}

/** The outcome of one iteration. */
export interface RalphIterationOutcome {
  iteration: number;
  consensus: ConsensusVerdict;
  plan?: RalphPlan;
  verification: VerificationEvidence[];
  verificationPassed: boolean;
  critique?: CriticVerdict;
  fixScore: number;
  /** Fast-decision verdict on the merged diagnosis, when one was taken. */
  diagnosisScore?: number;
  finalised: boolean;
  /** Set when the iteration threw; the error text is the evidence. */
  error?: string;
}

/** Why the loop stopped. */
export type RalphStopReason =
  | "finalised"
  | "no_consensus"
  | "diagnosis_rejected"
  | "budget_exhausted"
  | "stopped";

/** The result of a whole loop. */
export interface RalphLoopResult {
  finalised: boolean;
  iterations: RalphIterationOutcome[];
  stopReason: RalphStopReason;
  /** True when a human has to pick the work up. */
  needsHuman: boolean;
  /** How many turns/users this failure class has burned, 0-10. */
  classSeverity: number;
  finalOutcome?: RalphIterationOutcome;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toScore(value: number): number {
  return Math.round(clamp(value, 0, 10) * 10) / 10;
}

/** Normalises a root cause so oracles that phrase it differently can group. */
export function normaliseRootCause(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Merges independent oracle diagnoses into one consensus verdict.
 *
 * The vote is score-weighted: the root cause with the highest total
 * confidence wins, not the one with the most mentions. The consensus score is
 * the mean confidence of the winning group, discounted by the share of the
 * total confidence mass that group holds (never below half of its own
 * confidence, so a 2-of-3 majority can still clear the gate).
 *
 * The agreement rule requires both a majority of at least
 * {@link MIN_AGREEING_ORACLES} oracles AND a consensus score of at least
 * {@link CONSENSUS_MIN_SCORE}. A single confident oracle can never satisfy
 * it.
 */
export function mergeOracleDiagnoses(
  oracles: OracleDiagnosis[],
): ConsensusVerdict {
  const counted = oracles.filter(
    (oracle) => oracle.rootCause.trim().length > 0,
  );
  const total = counted.length;
  if (total === 0) {
    return {
      rootCause: "",
      score: 0,
      agreeing: 0,
      dissenting: 0,
      total: 0,
      agreed: false,
    };
  }

  const groups = new Map<
    string,
    { rootCause: string; members: OracleDiagnosis[]; mass: number }
  >();
  let totalMass = 0;
  for (const oracle of counted) {
    const confidence = clamp(oracle.confidence, 0, 10);
    totalMass += confidence;
    const key = normaliseRootCause(oracle.rootCause);
    const group = groups.get(key);
    if (group) {
      group.members.push(oracle);
      group.mass += confidence;
    } else {
      groups.set(key, {
        rootCause: oracle.rootCause,
        members: [oracle],
        mass: confidence,
      });
    }
  }

  let winner = groups.values().next().value as
    | { rootCause: string; members: OracleDiagnosis[]; mass: number }
    | undefined;
  for (const group of groups.values()) {
    if (!winner || group.mass > winner.mass) {
      winner = group;
    }
  }
  if (!winner) {
    return {
      rootCause: "",
      score: 0,
      agreeing: 0,
      dissenting: 0,
      total,
      agreed: false,
    };
  }

  const meanConfidence =
    winner.members.length > 0 ? winner.mass / winner.members.length : 0;
  const agreementRatio = totalMass > 0 ? winner.mass / totalMass : 0;
  const score = toScore(meanConfidence * (0.5 + 0.5 * agreementRatio));
  const required = Math.max(MIN_AGREEING_ORACLES, Math.ceil(total / 2));

  return {
    rootCause: winner.rootCause,
    score,
    agreeing: winner.members.length,
    dissenting: total - winner.members.length,
    total,
    agreed: winner.members.length >= required && score >= CONSENSUS_MIN_SCORE,
  };
}

/**
 * The fix score: 0 when the verification failed, 0 on a veto, otherwise the
 * critic's own score (or a solid default for an approving critic).
 */
export function computeFixScore(
  verificationPassed: boolean,
  critique: CriticVerdict,
): number {
  if (!verificationPassed) return 0;
  if (critique.verdict !== "approve") return 0;
  return toScore(
    critique.score === undefined
      ? DEFAULT_APPROVED_FIX_SCORE
      : clamp(critique.score, 0, 10),
  );
}

/** How many turns/users a failure class has burned, on a 0-10 scale. */
export function classSeverity(occurrences: number): number {
  return toScore(clamp(occurrences, 0, 10));
}

/**
 * Runs the bounded Ralph loop for one failure class.
 *
 * @param options.signature The failure class being fixed.
 * @param options.ports The injected steps.
 * @param options.maxIterations Iteration budget (capped at
 * {@link RALPH_MAX_ITERATIONS}).
 * @param options.appPath When given, the ledger entry is updated to
 * `handled` on success or `needs_human` when the loop ends without a
 * finalised fix.
 */
export async function runRalphLoop(options: {
  signature: string;
  ports: RalphPorts;
  maxIterations?: number;
  appPath?: string;
}): Promise<RalphLoopResult> {
  const { signature, ports } = options;
  const maxIterations = Math.min(
    RALPH_MAX_ITERATIONS,
    Math.max(1, Math.floor(options.maxIterations ?? RALPH_MAX_ITERATIONS)),
  );

  const iterations: RalphIterationOutcome[] = [];
  let previousEvidence: VerificationEvidence[] = [];
  let previousCritique: CriticVerdict | undefined;
  let severity = 0;

  if (options.appPath) {
    try {
      const ledger = await loadLedger(options.appPath);
      const entry = ledger.entries[signature];
      severity = classSeverity(entry?.occurrences ?? 0);
    } catch {
      severity = 0;
    }
  }

  const finish = async (
    stopReason: RalphStopReason,
    finalOutcome: RalphIterationOutcome | undefined,
  ): Promise<RalphLoopResult> => {
    const finalised = stopReason === "finalised";
    if (options.appPath) {
      await markLedgerStatus(
        options.appPath,
        signature,
        finalised ? "handled" : "needs_human",
      );
    }
    return {
      finalised,
      iterations,
      stopReason,
      needsHuman: !finalised,
      classSeverity: severity,
      finalOutcome,
    };
  };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const baseContext: RalphIterationContext = {
      signature,
      iteration,
      maxIterations,
      previousEvidence,
      previousCritique,
    };

    let consensus: ConsensusVerdict = mergeOracleDiagnoses([]);
    let plan: RalphPlan | undefined;
    let verification: VerificationEvidence[] = [];
    let critique: CriticVerdict | undefined;
    let verificationPassed = false;
    let diagnosisScore: number | undefined;
    let failure: string | undefined;

    try {
      // DIAGNOSE
      consensus = mergeOracleDiagnoses(await ports.diagnose(baseContext));
      if (!consensus.agreed) {
        iterations.push({
          iteration,
          consensus,
          verification: [],
          verificationPassed: false,
          fixScore: 0,
          finalised: false,
        });
        return await finish("no_consensus", iterations[iterations.length - 1]);
      }

      const context: RalphIterationContext = { ...baseContext, consensus };

      // The fast decision layer may only REJECT a merged diagnosis.
      if (ports.isDiagnosisPlausible) {
        const verdict = await ports.isDiagnosisPlausible(context);
        diagnosisScore = verdict.score;
        if (!verdict.ok) {
          iterations.push({
            iteration,
            consensus,
            verification: [],
            verificationPassed: false,
            fixScore: 0,
            diagnosisScore,
            finalised: false,
          });
          return await finish(
            "diagnosis_rejected",
            iterations[iterations.length - 1],
          );
        }
      }

      // PLAN
      plan = await ports.plan(context);
      // APPLY
      await ports.apply({ ...context, plan });
      // VERIFY
      verification = await ports.verify({ ...context, plan });
      verificationPassed =
        verification.length > 0 && verification.every((item) => item.passed);
      // CRITIQUE
      critique = await ports.critique({ ...context, plan });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const fixScore = computeFixScore(
      verificationPassed,
      critique ?? {
        verdict: "veto",
        reasons: ["critique did not complete"],
      },
    );
    const finalised =
      verificationPassed &&
      critique?.verdict === "approve" &&
      consensus.score >= CONSENSUS_MIN_SCORE &&
      fixScore >= FIX_MIN_SCORE;

    const outcome: RalphIterationOutcome = {
      iteration,
      consensus,
      plan,
      verification,
      verificationPassed,
      critique,
      fixScore,
      diagnosisScore,
      finalised,
      error: failure,
    };
    iterations.push(outcome);

    if (finalised) {
      return await finish("finalised", outcome);
    }

    previousEvidence = verification;
    previousCritique = critique;

    if (ports.shouldContinue) {
      const proceed = await ports.shouldContinue({
        ...baseContext,
        consensus,
        plan,
        previousEvidence: verification,
        previousCritique: critique,
      });
      if (!proceed) {
        return await finish("stopped", outcome);
      }
    }
  }

  return await finish("budget_exhausted", iterations[iterations.length - 1]);
}
