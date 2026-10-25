import { createTypedHandler } from "./base";
import { promptContracts } from "../types/prompts";
import { readSettings } from "@/main/settings";
import { getChatInferenceSettings } from "../services/chat_inference_settings";
import { refinePrompt } from "@/pro/main/ipc/handlers/local_agent/tools/improve_prompt";

/** One bounded request per trusted renderer; cancellation cannot target another window. */
export function registerPromptImprovementHandlers() {
  const active = new Map<
    number,
    { requestId: string; controller: AbortController }
  >();
  createTypedHandler(promptContracts.improve, async (event, params) => {
    const owner = event.sender.id;
    if (active.has(owner))
      throw new Error(
        "A prompt improvement is already running in this window.",
      );
    const entry = {
      requestId: params.requestId,
      controller: new AbortController(),
    };
    active.set(owner, entry);
    const onDestroyed = () => entry.controller.abort();
    event.sender.once("destroyed", onDestroyed);
    try {
      const settings = params.chatId
        ? await getChatInferenceSettings(params.chatId)
        : readSettings();
      entry.controller.signal.throwIfAborted();
      const result = await refinePrompt(
        { prompt: params.prompt, iterations: 1 },
        settings,
        entry.controller.signal,
      );
      entry.controller.signal.throwIfAborted();
      const prompt = result.versions.at(-1)?.prompt.trim();
      if (!prompt || prompt.length > 16000)
        throw new Error("The model returned an invalid prompt proposal.");
      return { prompt };
    } finally {
      event.sender.removeListener("destroyed", onDestroyed);
      if (active.get(owner) === entry) active.delete(owner);
    }
  });
  createTypedHandler(
    promptContracts.cancelImprovement,
    async (event, params) => {
      const entry = active.get(event.sender.id);
      if (entry?.requestId === params.requestId) entry.controller.abort();
    },
  );
}
