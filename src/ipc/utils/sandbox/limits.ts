export const SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES = 128 * 1024;
export const SANDBOX_LLM_OUTPUT_LIMIT_BYTES = 256 * 1024;
export const SANDBOX_UI_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
export const SANDBOX_READ_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

export const DEFAULT_SANDBOX_TIMEOUT_MS = 60_000;
export const MAX_SANDBOX_TIMEOUT_MS = 60_000;
export const SANDBOX_WALL_CLOCK_TIMEOUT_MS = 5 * 60_000;

// A finite step budget stops runaway `while` loops quickly instead of letting
// them burn the full 60s timeout and emit megabytes of repeated output. Large
// legitimate workloads (CSV parsing, big file transforms) still fit well
// inside 50M instructions.
export const SANDBOX_INSTRUCTION_BUDGET = 50_000_000;
export const SANDBOX_HEAP_LIMIT_BYTES = 128 * 1024 * 1024;
// V8 old-generation cap for the sandbox worker thread. Guest memory is bounded
// separately by SANDBOX_HEAP_LIMIT_BYTES inside the interpreter; this bounds the
// JS side (strings crossing the host boundary, result buffers) so an overrun
// terminates the worker instead of aborting the whole process.
export const SANDBOX_WORKER_HEAP_LIMIT_MB = 1024;
export const SANDBOX_ALLOCATION_BUDGET = 1_000_000;
export const SANDBOX_CALL_DEPTH_LIMIT = 512;
export const SANDBOX_MAX_OUTSTANDING_HOST_CALLS = 32;

export function clampSandboxTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_SANDBOX_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS), 1),
    MAX_SANDBOX_TIMEOUT_MS,
  );
}

export function clampSandboxWallClockTimeoutMs(
  timeoutMs: number | undefined,
): number {
  if (!Number.isFinite(timeoutMs)) {
    return SANDBOX_WALL_CLOCK_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? SANDBOX_WALL_CLOCK_TIMEOUT_MS), 1),
    SANDBOX_WALL_CLOCK_TIMEOUT_MS,
  );
}
