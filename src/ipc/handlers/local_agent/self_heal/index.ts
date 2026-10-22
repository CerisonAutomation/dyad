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
 *  - the always-open self-improvement chat
 *  - the auto-trigger scheduler
 *  - the prompt interceptor
 */

export {
  LEDGER_MAX_ENTRIES,
  capLedger,
  computeFailureSignature,
  deriveArgKey,
  emptyLedger,
  getLedgerPath,
  loadLedger,
  markLedgerStatus,
  normaliseErrorMessage,
  recordToolFailure,
  saveLedger,
} from "./ledger";
export {
  PREVENTION_PROMPT_MAX_RULES,
  addPreventionRule,
  buildPreventionPromptBlock,
  buildRuleId,
  emptyPrevention,
  getPreventionPath,
  loadPreventionRules,
  savePreventionRules,
} from "./prevention";
export { buildSelfHealInstruction } from "./instruction";
export {
  DEFAULT_JEV_TIMEOUT_MS,
  decideScore,
  decideYesNo,
  isDiagnosisPlausible,
  isDiffRootCauseFix,
  isPromptRewriteSafe,
  isWorthSelfHealAttempt,
  parseJevOutput,
  resetJevCommandCache,
  resolveJevCommand,
  shouldContinueRalphLoop,
} from "./decision";
export type {
  JevCommand,
  JevMode,
  JevRunResult,
  ParsedJevOutput,
} from "./decision";
export { assertSelfHealScope } from "./scope";
export {
  CONSENSUS_MIN_SCORE,
  DEFAULT_APPROVED_FIX_SCORE,
  DEFAULT_ORACLE_COUNT,
  FIX_MIN_SCORE,
  MIN_AGREEING_ORACLES,
  RALPH_MAX_ITERATIONS,
  classSeverity,
  computeFixScore,
  mergeOracleDiagnoses,
  normaliseRootCause,
  runRalphLoop,
} from "./ralph";
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
export {
  CAVEMAN_BLOCK,
  HEADROOM_BLOCK,
  buildArchitectDesignerPrompt,
  composePersonaPrompt,
} from "./prompts";
export {
  ARCHITECT_ROLE_BLOCK,
  RESEARCH_CONTRACT_BLOCK,
  SELF_IMPROVE_APP_NAME,
  SELF_IMPROVE_CHAT_MODE,
  SELF_IMPROVE_CHAT_TITLE,
  assertDyadSourceRoot,
  buildSelfImproveChatSystemPrompt,
  buildSelfImproveRunPrompt,
  buildSelfImproveSystemPrompt,
  createDrizzleSelfImproveChatStore,
  ensureSelfImproveChat,
  isSelfImproveAppName,
  isSelfImproveChatTitle,
  resolveDyadSourceRoot,
} from "./chat";
export type { SelfImproveChatRef, SelfImproveChatStore } from "./chat";
export {
  COMMON_LIBRARIES,
  DYAD_TOOL_NAMES,
  INTERCEPTOR_SYSTEM_PROMPT,
  INTERCEPTOR_TIMEOUT_MS,
  MAX_ADDED_GUIDANCE_CHARS,
  MIN_INTENT_COVERAGE,
  MIN_INTERCEPTION_CONFIDENCE,
  assembleImprovedPrompt,
  buildDecisionState,
  buildGuidanceBlock,
  buildInterceptorPayload,
  contentTokens,
  contentWordCoverage,
  extractKeyTerms,
  interceptPrompt,
  matchMcpTools,
  matchPreventionRules,
  matchSkills,
  parseInterceptorVerdict,
  preservesIntent,
  proposeResearchRequests,
  truncateGuidance,
  wrapUntrusted,
} from "./interceptor";
export type {
  InterceptionResult,
  InterceptorCandidates,
  InterceptorMcpTool,
} from "./interceptor";
export {
  AUTO_TRIGGER_CHECK_INTERVAL_MS,
  AUTO_TRIGGER_MIN_INTERVAL_MS,
  collectOpenSignatures,
  createAutoTriggerScheduler,
  readOpenSignatures,
  runAutoTrigger,
  shouldAutoTrigger,
} from "./auto_trigger";
export type {
  AutoTriggerDecision,
  AutoTriggerDeps,
  AutoTriggerOutcome,
  AutoTriggerRefusal,
  AutoTriggerScheduler,
  AutoTriggerState,
} from "./auto_trigger";
export type {
  JevScoreDecision,
  JevYesNoDecision,
  LedgerEntry,
  LedgerFile,
  LedgerStatus,
  PreventionFile,
  PreventionRule,
} from "./types";
