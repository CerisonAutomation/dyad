/**
 * Shared types for the Dyad self-improvement (self-heal) module.
 *
 * The module owns every artefact it produces:
 *  - the failure ledger (`.dyad/self-heal/ledger.json`)
 *  - the prevention rule store (`.dyad/self-heal/prevention.json`)
 *  - the decision-layer results
 *
 * Nothing outside this directory should import from here directly; use
 * `./index` (the public API) instead.
 */

/** Lifecycle of a failure class in the ledger. */
export type LedgerStatus = "open" | "handled" | "needs_human";

/** One failure class, collapsed across instances. */
export interface LedgerEntry {
  /** Stable identity of the failure class. */
  signature: string;
  /** Tool that produced the failure. */
  toolName: string;
  /** Dyad error kind, or "unknown" for unclassified errors. */
  errorKind: string;
  /** Raw (un-normalised) error message, truncated for storage. */
  errorMessage: string;
  /** Stable argument shape that distinguishes failure classes. */
  argKey: string;
  /** How many times this class has been observed. */
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  status: LedgerStatus;
}

/** On-disk shape of `ledger.json`. */
export interface LedgerFile {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

/**
 * A rule that must hold in future turns so the same failure class does not
 * come back.
 */
export interface PreventionRule {
  id: string;
  title: string;
  rule: string;
  createdAt: number;
  /** Ledger signature the rule was derived from. */
  sourceSignature: string;
  /** How many times the originating failure class was seen. */
  occurrences: number;
}

/** On-disk shape of `prevention.json`. */
export interface PreventionFile {
  version: 1;
  rules: PreventionRule[];
}

/** Result of a yes/no decision taken by the fast decision layer. */
export interface JevYesNoDecision {
  /** The yes/no verdict. `false` whenever the decision was unavailable. */
  ok: boolean;
  /** Confidence on a 0-10 scale. `0` when the decision was unavailable. */
  score: number;
  /** True when the decision layer could not answer (fail closed). */
  unavailable: boolean;
}

/** Result of a 0-10 score taken by the fast decision layer. */
export interface JevScoreDecision {
  /** Score on a 0-10 scale. `0` when the decision layer could not answer. */
  score: number;
  /** True when the decision layer could not answer (fail closed). */
  unavailable: boolean;
}
