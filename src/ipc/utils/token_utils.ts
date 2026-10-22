import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "../../main/settings";
import { Message } from "@/ipc/types";
import { getErrorMessage } from "@ai-sdk/provider";

import { findLanguageModel } from "./findLanguageModel";

// Estimate tokens (4 characters per token)
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

type ToolResultForTokenEstimate = {
  toolCallId: string;
  toolName: string;
  output: unknown;
};

type ToolErrorForTokenEstimate = {
  toolCallId: string;
  toolName: string;
  error: unknown;
};

/**
 * Estimate the tokens that completed tool results will add to the next model
 * request. Tool inputs are intentionally excluded because the engine's usage
 * for the completed step already counted them.
 *
 * Only the SIZE of each result matters, so the payload is measured by walking
 * it rather than by serializing it. `JSON.stringify` over the whole step
 * re-materialized every tool output as one giant string purely to take its
 * `.length` - up to 20 MB of transient allocation (and a main-thread stall)
 * for a step whose results were already in memory.
 *
 * `jsonSerializedLength` reproduces `JSON.stringify(...).length` exactly, so
 * the estimate is unchanged - only the allocation is gone.
 */
export const estimateToolResultTokens = (
  toolResults: readonly ToolResultForTokenEstimate[],
  toolErrors: readonly ToolErrorForTokenEstimate[] = [],
  maxCharsPerResult?: number,
): number => {
  if (toolResults.length === 0 && toolErrors.length === 0) {
    return 0;
  }

  // The previous implementation serialized an ARRAY of envelopes, so the
  // brackets and the separating commas are part of the measured size. Keep
  // them so the estimate is bit-for-bit identical to the old one.
  let totalChars = 2; // "[" and "]"
  let count = 0;
  for (const { toolCallId, toolName, output } of toolResults) {
    if (count > 0) {
      totalChars += 1; // comma between envelopes
    }
    count += 1;
    totalChars += toolResultEnvelopeLength(
      toolCallId,
      toolName,
      output,
      maxCharsPerResult,
    );
  }
  for (const { toolCallId, toolName, error } of toolErrors) {
    if (count > 0) {
      totalChars += 1; // comma between envelopes
    }
    count += 1;
    totalChars += toolResultEnvelopeLength(
      toolCallId,
      toolName,
      {
        type: "error-text",
        value: getErrorMessage(error),
      },
      maxCharsPerResult,
    );
  }

  // Same 4-characters-per-token rule as `estimateTokens`, applied to the
  // measured size without materializing a string of that size.
  return Math.ceil(totalChars / 4);
};

/**
 * The serialized length of one tool-result envelope:
 * `{"type":"tool-result","toolCallId":..,"toolName":..,"output":..}`
 */
function toolResultEnvelopeLength(
  toolCallId: string,
  toolName: string,
  output: unknown,
  maxCharsPerResult?: number,
): number {
  const outputLength =
    maxCharsPerResult == null
      ? jsonSerializedLength(output)
      : Math.min(jsonSerializedLength(output), maxCharsPerResult);
  return (
    2 + // "{" and "}"
    jsonStringLength("type") +
    1 + // ":"
    jsonStringLength("tool-result") +
    1 + // ","
    jsonStringLength("toolCallId") +
    1 + // ":"
    jsonStringLength(toolCallId) +
    1 + // ","
    jsonStringLength("toolName") +
    1 + // ":"
    jsonStringLength(toolName) +
    1 + // ","
    jsonStringLength("output") +
    1 + // ":"
    outputLength
  );
}

/**
 * The length of `JSON.stringify(value)`, without building the string.
 *
 * Mirrors the JSON.stringify rules that matter for tool payloads: string
 * escaping, number formatting, null/true/false, and the omission of
 * `undefined` object properties.
 */
export function jsonSerializedLength(value: unknown): number {
  switch (typeof value) {
    case "string":
      return jsonStringLength(value);
    case "number":
      return jsonNumberLength(value);
    case "boolean":
      return value ? 4 : 5;
    case "bigint":
      // JSON.stringify throws on bigint; the previous implementation
      // converted it to a string via the replacer.
      return jsonStringLength(value.toString());
    case "undefined":
      // At the top level JSON.stringify returns undefined; inside an array it
      // becomes null. Treat the value as "null" so callers get a usable size.
      return 4;
    case "function":
    case "symbol":
      return 0;
    default:
      break;
  }
  if (value === null) {
    return 4;
  }
  if (Array.isArray(value)) {
    let total = 2; // "[" and "]"
    let count = 0;
    for (const item of value) {
      if (count > 0) {
        total += 1; // comma between elements
      }
      count += 1;
      total += jsonSerializedLength(item === undefined ? null : item);
    }
    return total;
  }
  if (value instanceof Date) {
    return jsonStringLength(value.toISOString());
  }
  const record = value as Record<string, unknown>;
  let total = 2; // "{" and "}"
  let count = 0;
  for (const [key, item] of Object.entries(record)) {
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol"
    ) {
      // JSON.stringify omits these properties entirely.
      continue;
    }
    if (count > 0) {
      total += 1; // comma
    }
    count += 1;
    total += jsonStringLength(key);
    total += 1; // colon
    total += jsonSerializedLength(item);
  }
  return total;
}

/** The length of `JSON.stringify(text)` including the surrounding quotes. */
export function jsonStringLength(text: string): number {
  let length = 2; // quotes
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    switch (code) {
      case 0x22: // "
      case 0x5c: // backslash
      case 0x08: // backspace
      case 0x09: // tab
      case 0x0a: // newline
      case 0x0c: // form feed
      case 0x0d: // carriage return
        length += 2;
        break;
      default:
        if (code < 0x20) {
          length += 6; // \u00XX
        } else if (code >= 0xd800 && code <= 0xdfff) {
          // A lone surrogate is escaped as \uXXXX; a valid pair is emitted
          // as-is by JSON.stringify (well-formed stringify, ES2019).
          const isHighSurrogate =
            code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
          const next = isHighSurrogate ? text.charCodeAt(i + 1) : 0;
          if (isHighSurrogate && next >= 0xdc00 && next <= 0xdfff) {
            length += 2; // the pair is emitted as two UTF-16 units
            i += 1;
          } else {
            length += 6; // \uXXXX
          }
        } else {
          length += 1;
        }
        break;
    }
  }
  return length;
}

/** The length of `JSON.stringify(number)`. */
function jsonNumberLength(value: number): number {
  if (!Number.isFinite(value)) {
    return 4; // JSON.stringify(NaN) === "null"
  }
  return String(value).length;
}

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce(
    (acc, message) => acc + estimateTokens(message.content),
    0,
  );
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export async function getContextWindow(model?: LargeLanguageModel) {
  const selectedModel = model ?? readSettings().selectedModel;
  const modelOption = await findLanguageModel(selectedModel);
  return modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
}

export async function getMaxTokens(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  const declared = modelOption?.maxOutputTokens;
  if (declared === undefined) return undefined;
  // A model can declare an output ceiling equal to its entire context window
  // (e.g. 1M output on a 1M context). Input and output must both fit within
  // the limit, so any non-empty prompt then overflows. Reserve headroom for
  // the prompt instead of trusting the declared ceiling.
  const contextWindow = modelOption?.contextWindow;
  if (!contextWindow || contextWindow <= 0) return declared;
  return Math.min(declared, Math.max(1_000, contextWindow - 32_000));
}

export async function getTemperature(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.temperature ?? undefined;
}

/**
 * Calculate the token threshold for triggering context compaction.
 *
 * Returns the lower of a per-provider cap or `contextWindow - 25k`. The 25k
 * headroom leaves room for the next user message + tool outputs before we hit
 * the hard context limit.
 *
 * Per-provider caps differ because of input-token pricing tiers and operational
 * headroom. Google compacts before its 200k pricing boundary, while OpenAI
 * compacts at 220k to leave more room for tool-heavy agent steps. Other
 * providers retain the historical 250k cap.
 */
export function getCompactionThreshold(
  contextWindow: number,
  provider: string,
): number {
  const cap =
    provider === "google" ? 190_000 : provider === "openai" ? 220_000 : 250_000;
  return Math.min(cap, Math.max(0, contextWindow - 25_000));
}

/**
 * Check if compaction should be triggered based on total tokens used.
 */
export function shouldTriggerCompaction(
  totalTokens: number,
  contextWindow: number,
  provider: string,
): boolean {
  return totalTokens >= getCompactionThreshold(contextWindow, provider);
}
