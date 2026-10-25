import { useSyncExternalStore } from "react";
import { Volume2, Square, Loader2 } from "lucide-react";
import {
  getLocalSpeechState,
  subscribeLocalSpeech,
  startLocalSpeech,
  stopLocalSpeech,
} from "@/local_tts/client";
let downloadApproved = false;
export function LocalSpeechButton({ text }: { text: string }) {
  const state = useSyncExternalStore(subscribeLocalSpeech, getLocalSpeechState);
  const active = state.status === "loading" || state.status === "playing";
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={active ? "Stop local speech" : "Read aloud locally"}
        title="Local Kokoro speech · first use downloads model files; no text is sent to a speech API"
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => {
          if (active) {
            stopLocalSpeech();
            return;
          }
          if (!downloadApproved) {
            downloadApproved = window.confirm(
              "Download the free Apache-2.0 Kokoro voice model for local speech? The download can exceed 100 MB and is cached by the browser when available. Your text stays on this device; no paid speech API is used.",
            );
            if (!downloadApproved) return;
          }
          startLocalSpeech(text);
        }}
      >
        {state.status === "loading" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : active ? (
          <Square className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </button>
      {state.status === "error" && (
        <span role="alert" className="max-w-64 text-xs text-destructive">
          {state.error}
        </span>
      )}
    </span>
  );
}
