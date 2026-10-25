import { app } from "electron";
import { streamText } from "ai";
import { readSettings } from "../../main/settings";

import log from "electron-log";
import { safeSend } from "../utils/safe_sender";
import {
  cancelOrphanedBaseStream,
  fastTextOutput,
} from "../utils/stream_text_utils";
import { getNativeProviderOptions } from "@/ipc/utils/provider_options";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { resolveDefaultModelSelection } from "@/ipc/utils/model_effort";
import { providerOnlyInferenceSettings } from "@/lib/providerOnlyInference";
import { createTypedHandler } from "./base";
import { helpContracts } from "../types/help";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("help-bot");

// In-memory session store for help bot conversations
type HelpMessage = { role: "user" | "assistant"; content: string };
const helpSessions = new Map<string, HelpMessage[]>();
const activeHelpStreams = new Map<string, AbortController>();

export function registerHelpBotHandlers() {
  // Abort in-flight help-bot streams and drop session history on quit.
  // (Guarded: `app` is undefined when this module is imported in unit tests.)
  app?.on?.("before-quit", () => {
    for (const controller of activeHelpStreams.values()) {
      controller.abort();
    }
    activeHelpStreams.clear();
    helpSessions.clear();
  });

  createTypedHandler(helpContracts.start, async (event, params) => {
    const { sessionId, message } = params;
    let initiatingController: AbortController | undefined;
    try {
      if (!sessionId || !message?.trim()) {
        throw new DyadError(
          "Missing sessionId or message",
          DyadErrorKind.External,
        );
      }

      // Clear any existing active streams (only one session at a time)
      for (const [existingSessionId, controller] of activeHelpStreams) {
        controller.abort();
        activeHelpStreams.delete(existingSessionId);
        helpSessions.delete(existingSessionId);
      }

      // Append user message to session history
      const history = helpSessions.get(sessionId) ?? [];
      const updatedHistory: HelpMessage[] = [
        ...history.slice(-19),
        { role: "user", content: message.slice(0, 20000) },
      ];

      const abortController = new AbortController();
      initiatingController = abortController;
      activeHelpStreams.set(sessionId, abortController);
      const settings = providerOnlyInferenceSettings(readSettings());
      const selectedModel = await resolveDefaultModelSelection(settings);
      const { modelClient } = await getModelClient(selectedModel, {
        ...settings,
        selectedModel,
      });
      abortController.signal.throwIfAborted();

      let assistantContent = "";

      const stream = streamText({
        output: fastTextOutput(),
        model: modelClient.model,
        providerOptions: getNativeProviderOptions({
          modelSelection: selectedModel,
          builtinProviderId: modelClient.builtinProviderId,
          reasoningEffortProviderId: modelClient.reasoningEffortProviderId,
        }),
        abortSignal: abortController.signal,
        system:
          "Help the user work with this local AI app builder. State uncertainty and do not claim to inspect files, browse, or execute tools that are not supplied. Use the configured provider; do not recommend a Dyad subscription as a prerequisite.",
        messages: updatedHistory.slice(-20),
        maxRetries: 1,
        maxOutputTokens: 4096,
        onError: (error) => {
          if (abortController.signal.aborted) return;
          let errorMessage = (error as any)?.error?.message;
          logger.error("help bot stream error", errorMessage);
          safeSend(event.sender, "help:chat:response:error", {
            sessionId,
            error: String(errorMessage),
          });
        },
      });

      // Read .fullStream now (not lazily) so the SDK's `teeStream()`
      // runs synchronously, then cancel the orphaned tee branch before
      // any chunks are pumped. See `cancelOrphanedBaseStream` for why
      // this is required.
      const fullStream = stream.fullStream;
      cancelOrphanedBaseStream(stream);

      (async () => {
        try {
          for await (const part of fullStream) {
            if (abortController.signal.aborted) break;

            if (part.type === "text-delta") {
              assistantContent += part.text;
              safeSend(event.sender, "help:chat:response:chunk", {
                sessionId,
                delta: part.text,
                type: "text",
              });
            }
          }

          if (
            abortController.signal.aborted ||
            activeHelpStreams.get(sessionId) !== abortController
          )
            return;
          // Finalize session history
          const finalHistory: HelpMessage[] = [
            ...updatedHistory,
            { role: "assistant", content: assistantContent },
          ];
          helpSessions.set(sessionId, finalHistory.slice(-20));
          if (helpSessions.size > 32)
            helpSessions.delete(helpSessions.keys().next().value!);

          safeSend(event.sender, "help:chat:response:end", { sessionId });
        } catch (err) {
          if (
            abortController.signal.aborted ||
            (err as any)?.name === "AbortError"
          ) {
            logger.log("help bot stream aborted", sessionId);
            return;
          }
          logger.error("help bot stream loop error", err);
          safeSend(event.sender, "help:chat:response:error", {
            sessionId,
            error: String(err instanceof Error ? err.message : err),
          });
        } finally {
          if (activeHelpStreams.get(sessionId) === abortController)
            activeHelpStreams.delete(sessionId);
        }
      })();

      return { ok: true } as const;
    } catch (err) {
      logger.error("help:chat:start error", err);
      if (activeHelpStreams.get(sessionId) === initiatingController)
        activeHelpStreams.delete(sessionId);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

  createTypedHandler(helpContracts.cancel, async (_, sessionId) => {
    const controller = activeHelpStreams.get(sessionId);
    if (controller) {
      controller.abort();
      activeHelpStreams.delete(sessionId);
    }
    return { ok: true } as const;
  });
}
