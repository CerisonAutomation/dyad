import type { UserSettings } from "@/lib/schemas";
import { buildMcpConsentSystemPrompt } from "@/prompts/mcp_consent_policy";
import type { McpAutoApproveResult } from "@/ipc/utils/mcp_consent";
import { reviewToolAction } from "./tool_safety_reviewer";
import {
  formatRecentTurns,
  getRecentTurnsForConsent,
  type RecentTurn,
} from "./mcp_consent_context";

<<<<<<< HEAD
=======
const logger = log.scope("mcp-auto-consent");

const CLASSIFIER_TIMEOUT_MS = 8000;

>>>>>>> 5680f080 (Checkpoint: Pro->Agent2 conversion, local tool de-engineering, spawn retry, model picker)
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
  signal?: AbortSignal;
}

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
  return reviewToolAction({
    settings: input.settings,
    system: buildMcpConsentSystemPrompt(),
    fallback: "ask",
    signal: input.signal,
    prepare: async () => ({ payload: buildUserPayload(input) }),
  });
<<<<<<< HEAD
=======
  try {
    // Classify with the user's own model. A compiled-in OpenAI model made
    // auto-consent impossible for anyone without that key.
    const classifierModel: LargeLanguageModel =
      input.settings.selectedModel;
    const { modelClient } = await getModelClient(
      classifierModel,
      input.settings,
    );

    const stream = streamText({
      output: fastTextOutput(),
      model: modelClient.model,
      system: buildMcpConsentSystemPrompt(),
      maxRetries: 1,
      abortSignal: controller.signal,
      messages: [{ role: "user", content: buildUserPayload(input) }],
    });

    // If the timeout wins the race, stream.text is orphaned and may reject
    // later (when abort propagates). Swallow it so it can't become an
    // unhandled rejection that accumulates across many calls.
    const textPromise = Promise.resolve(stream.text);
    textPromise.catch(() => {});
    const text = await Promise.race([textPromise, timeout]);
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
  }
>>>>>>> 5680f080 (Checkpoint: Pro->Agent2 conversion, local tool de-engineering, spawn retry, model picker)
}

// Builds the auto-approve callback for requireMcpToolConsent, or undefined when
// the feature is off or the turn is running in Dyad Free mode. Shared by both
// agent MCP paths (sandbox host functions and directly-registered tools) so
// auto-approval behaves the same regardless of how the tool is plumbed.
export function buildMcpAutoApprove(params: {
  signal?: AbortSignal;
  settings: UserSettings;
  isDyadPro: boolean;
  freeModelMode?: boolean;
  chatId: number;
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
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
