import { streamText } from "ai";
import { z } from "zod";
import log from "electron-log";
import { getModelClient } from "@/ipc/utils/get_model_client";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";
import { buildMcpConsentSystemPrompt } from "@/prompts/mcp_consent_policy";
import type { McpAutoApproveResult } from "@/ipc/utils/mcp_consent";
import { fastTextOutput } from "@/ipc/utils/stream_text_utils";
import { extractJson } from "@/ipc/utils/extract_json";
import {
  formatRecentTurns,
  getRecentTurnsForConsent,
  type RecentTurn,
} from "./mcp_consent_context";

const logger = log.scope("mcp-auto-consent");

// The whole verdict (model-client setup AND the request) shares this single
// deadline, so one classification can never take longer than eight seconds.
const CLASSIFIER_TIMEOUT_MS = 8000;

export interface McpConsentDecision {
  decision: "allow" | "ask";
  reason: string;
}

export interface ClassifyMcpToolConsentInput {
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
  recentTurns: RecentTurn[];
  settings: UserSettings;
  /**
   * Turn-scoped abort signal. When the user stops the turn, the classifier
   * must not start (or keep running) inference.
   */
  signal?: AbortSignal;
}

// Fail-closed default: when anything goes wrong, ask.
function ask(reason: string): McpConsentDecision {
  return { decision: "ask", reason };
}

// reason is emitted first so it acts as a brief reasoning step before the
// verdict, not a post-hoc rationalization.
const rawDecisionSchema = z.object({
  reason: z.string().optional(),
  decision: z.enum(["allow", "ask"]),
});

function buildUserPayload(input: ClassifyMcpToolConsentInput): string {
  const schema = input.inputSchema
    ? JSON.stringify(input.inputSchema)
    : "(none)";
  const lines = [
    `MCP server: ${input.serverName}`,
    `Tool: ${input.toolName}`,
    `Description: ${input.toolDescription ?? "(none)"}`,
    `Input schema: ${schema}`,
    `Arguments: ${JSON.stringify(input.args)}`,
  ];
  if (input.recentTurns.length > 0) {
    lines.push(
      "",
      "Recent conversation (oldest first):",
      formatRecentTurns(input.recentTurns),
    );
  }
  return lines.join("\n");
}

export async function classifyMcpToolConsent(
  input: ClassifyMcpToolConsentInput,
): Promise<McpConsentDecision> {
  const controller = new AbortController();
  const callerSignal = input.signal;
  // Turn cancellation and the classifier's own deadline share one signal so a
  // stopped turn can never leave inference running in the background.
  const combinedSignal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    if (callerSignal?.aborted) {
      return ask("Turn was cancelled before classification.");
    }

    // Classify with the user's own model. A compiled-in OpenAI model made
    // auto-consent impossible for anyone without that key.
    const classifierModel: LargeLanguageModel = input.settings.selectedModel;

    // ONE deadline for the whole verdict: model-client setup and the request
    // share the eight-second budget instead of the request getting a fresh
    // eight seconds after a slow setup.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject first so the timeout wins the race against the abort it
        // triggers, then abort to cancel the in-flight request.
        reject(new Error("classifier timeout"));
        controller.abort();
      }, CLASSIFIER_TIMEOUT_MS);
    });
    // The same promise is raced more than once; make sure a late rejection
    // can't surface as an unhandled rejection.
    void timeout.catch(() => {});

    // Cancellation ends the verdict immediately instead of waiting for the
    // deadline to expire.
    const cancelled = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error("classifier cancelled"));
      combinedSignal.addEventListener("abort", abortListener, { once: true });
    });
    void cancelled.catch(() => {});

    const { modelClient } = await Promise.race([
      getModelClient(classifierModel, input.settings),
      timeout,
      cancelled,
    ]);

    // The turn may have been cancelled while the model client was resolving.
    // Re-check before spending a request.
    if (combinedSignal.aborted) {
      return ask("Turn was cancelled before classification.");
    }

    // Race the stream against a timeout that rejects, so a stuck request can
    // never block the tool call. On timeout, abort() cancels the in-flight
    // request so it doesn't keep running after we've moved on.
    const stream = streamText({
      output: fastTextOutput(),
      model: modelClient.model,
      system: buildMcpConsentSystemPrompt(),
      maxRetries: 1,
      abortSignal: combinedSignal,
      messages: [{ role: "user", content: buildUserPayload(input) }],
    });

    // If the timeout wins the race, stream.text is orphaned and may reject
    // later (when abort propagates). Swallow it so it can't become an
    // unhandled rejection that accumulates across many calls.
    const textPromise = Promise.resolve(stream.text);
    textPromise.catch(() => {});
    const text = await Promise.race([textPromise, timeout, cancelled]);
    const json = extractJson(text);
    if (!json) return ask("Classifier returned no parseable decision.");

    const parsed = rawDecisionSchema.parse(JSON.parse(json));
    const decision: McpConsentDecision = {
      decision: parsed.decision,
      reason: parsed.reason?.trim() || "No reason provided.",
    };
    logger.info(
      `${input.serverName}/${input.toolName} -> ${decision.decision}: ${decision.reason}`,
    );
    return decision;
  } catch (error) {
    logger.warn(
      `Classifier failed for ${input.serverName}/${input.toolName}, asking:`,
      error,
    );
    return ask("Could not evaluate the tool call automatically.");
  } finally {
    clearTimeout(timer);
    if (abortListener) {
      combinedSignal.removeEventListener("abort", abortListener);
    }
  }
}

// Builds the auto-approve callback for requireMcpToolConsent, or undefined when
// the feature is off or the turn is running in Dyad Free mode. Shared by both
// agent MCP paths (sandbox host functions and directly-registered tools) so
// auto-approval behaves the same regardless of how the tool is plumbed.
export function buildMcpAutoApprove(params: {
  settings: UserSettings;
  isDyadPro: boolean;
  freeModelMode?: boolean;
  chatId: number;
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
  /**
   * Turn-scoped abort signal. Pass the turn's signal so a stopped turn cannot
   * leave the classifier running inference in the background.
   */
  signal?: AbortSignal;
}): (() => Promise<McpAutoApproveResult>) | undefined {
  if (
    !params.settings.autoApproveSafeMcpTools ||
    !params.isDyadPro ||
    params.freeModelMode
  ) {
    return undefined;
  }
  return async () => {
    // On error, fall through to the consent prompt. Without this, the error
    // propagates and the tool call errors out instead of asking.
    try {
      const recentTurns = await getRecentTurnsForConsent(params.chatId);
      const decision = await classifyMcpToolConsent({
        serverName: params.serverName,
        toolName: params.toolName,
        toolDescription: params.toolDescription,
        inputSchema: params.inputSchema,
        args: params.args,
        recentTurns,
        settings: params.settings,
        signal: params.signal,
      });
      return {
        approved: decision.decision === "allow",
        reason: decision.reason,
      };
    } catch {
      return { approved: false };
    }
  };
}
