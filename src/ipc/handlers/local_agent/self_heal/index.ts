/**
 * Dyad self-improvement (self-heal) module — public API.
 *
 * This is the ONLY surface other files may import. Everything else in this
 * directory is an implementation detail.
 *
 * The module owns:
 *  - the failure ledger (`.dyad/self-heal/ledger.json`)
 *  - the prevention rule store (`.dyad/self-heal/prevention.json`)
 *  - the deterministic self-heal instruction
 *  - the fast decision layer (shells out to the `jev` CLI)
 *  - the scope guard
 *  - the Ralph loop
 *  - the architect-designer prompt
 */

export {
  computeFailureSignature,
  deriveArgKey,
  getLedgerPath,
  loadLedger,
  markLedgerStatus,
  normaliseErrorMessage,
  recordToolFailure,
  LEDGER_MAX_ENTRIES,
} from "./ledger";

export {
  addPreventionRule,
  buildPreventionPromptBlock,
  getPreventionPath,
  loadPreventionRules,
  PREVENTION_PROMPT_MAX_RULES,
} from "./prevention";

export { buildSelfHealInstruction } from "./instruction";

export {
  decideScore,
  decideYesNo,
  isDiagnosisPlausible,
  isDiffRootCauseFix,
  isPromptRewriteSafe,
  isWorthSelfHealAttempt,
  parseJevOutput,
  resolveJevCommand,
  shouldContinueRalphLoop,
  DEFAULT_JEV_TIMEOUT_MS,
} from "./decision";

export { assertSelfHealScope } from "./scope";

export {
  classSeverity,
  computeFixScore,
  mergeOracleDiagnoses,
  normaliseRootCause,
  runRalphLoop,
  CONSENSUS_MIN_SCORE,
  DEFAULT_ORACLE_COUNT,
  FIX_MIN_SCORE,
  MIN_AGREEING_ORACLES,
  RALPH_MAX_ITERATIONS,
} from "./ralph";

export {
  buildArchitectDesignerPrompt,
  composePersonaPrompt,
  CAVEMAN_BLOCK,
  HEADROOM_BLOCK,
} from "./prompts";

export type {
  JevScoreDecision,
  JevYesNoDecision,
  LedgerEntry,
  LedgerFile,
  LedgerStatus,
  PreventionFile,
  PreventionRule,
} from "./types";

export type {
  ConsensusVerdict,
  CriticVerdict,
  OracleDiagnosis,
  RalphIterationContext,
  RalphIterationOutcome,
  RalphLoopResult,
  RalphPlan,
  RalphPorts,
  RalphStopReason,
  VerificationEvidence,
} from "./ralph";

export type { JevCommand, JevMode, ParsedJevOutput } from "./decision";
