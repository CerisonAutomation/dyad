export type SpeechState = {
  status: "idle" | "loading" | "playing" | "error";
  error?: string;
};
let state: SpeechState = { status: "idle" };
let worker: Worker | undefined;
let audio: HTMLAudioElement | undefined;
let url: string | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
const MAX_AUDIO_BYTES = 24000 * 600 * 4 + 44;
const listeners = new Set<() => void>();
function publish(next: SpeechState) {
  state = next;
  listeners.forEach((listener) => listener());
}
export const getLocalSpeechState = () => state;
export function subscribeLocalSpeech(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function stopLocalSpeech() {
  generation += 1;
  worker?.terminate();
  worker = undefined;
  if (timeout) clearTimeout(timeout);
  timeout = undefined;
  if (audio) {
    // Detach first: pause/src changes can themselves dispatch media events.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = "";
    audio = undefined;
  }
  if (url) URL.revokeObjectURL(url);
  url = undefined;
  publish({ status: "idle" });
}
export function startLocalSpeech(text: string) {
  stopLocalSpeech();
  if (typeof text !== "string" || !text.trim() || text.length > 4000) {
    publish({
      status: "error",
      error: "Select a message of 1–4000 characters for local speech.",
    });
    return;
  }
  const requestGeneration = generation;
  const isCurrent = () => generation === requestGeneration;
  publish({ status: "loading" });
  const fail = (message: string) => {
    if (!isCurrent()) return;
    stopLocalSpeech();
    publish({ status: "error", error: message });
  };
  try {
    const current = new Worker(new URL("./speech.worker.ts", import.meta.url), {
      type: "module",
    });
    worker = current;
    let receivedAudio = false;
    timeout = setTimeout(
      () =>
        fail("Local speech timed out. Check the model download and try again."),
      180_000,
    );
    current.onerror = (event) => {
      event.preventDefault();
      if (!receivedAudio)
        fail(
          "Local voice could not load. Check model download availability and browser WASM support.",
        );
    };
    current.onmessage = async (event: MessageEvent<unknown>) => {
      if (!isCurrent() || receivedAudio) return;
      try {
        const payload = event.data as {
          type?: string;
          blob?: Blob;
          message?: string;
        } | null;
        if (!payload || typeof payload !== "object")
          throw new Error("Invalid local speech result");
        if (payload.type === "error") {
          fail(
            typeof payload.message === "string"
              ? payload.message
              : "Local speech failed",
          );
          return;
        }
        if (payload.type !== "audio") return;
        if (
          !(payload.blob instanceof Blob) ||
          payload.blob.size < 44 ||
          payload.blob.size > MAX_AUDIO_BYTES
        ) {
          throw new Error("Invalid or oversized local audio result");
        }
        receivedAudio = true;
        // Inference is done. Release ONNX model/WASM memory during playback.
        current.terminate();
        worker = undefined;
        url = URL.createObjectURL(payload.blob);
        const player = new Audio(url);
        audio = player;
        player.onended = () => {
          if (isCurrent()) stopLocalSpeech();
        };
        player.onerror = () => fail("Local audio playback failed");
        // Retain the startup watchdog until play() settles; a stalled playback
        // promise must not leave the interface permanently in Loading.
        await player.play();
        if (!isCurrent()) return;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(
          () => fail("Local audio exceeded its playback time limit."),
          605_000,
        );
        publish({ status: "playing" });
      } catch {
        fail(
          "Local audio could not be played. Try again or check browser audio support.",
        );
      }
    };
    current.postMessage({ text });
  } catch {
    fail("This browser cannot start the local speech worker.");
  }
}
if (typeof window !== "undefined")
  window.addEventListener("pagehide", stopLocalSpeech);
