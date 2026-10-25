import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getLocalSpeechState,
  startLocalSpeech,
  stopLocalSpeech,
} from "./client";
class FakeWorker {
  static instances: FakeWorker[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  constructor() {
    FakeWorker.instances.push(this);
  }
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  stopLocalSpeech();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("sends text only to a local module worker", () => {
  startLocalSpeech("Hello local speech");
  expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith({
    text: "Hello local speech",
  });
  expect(getLocalSpeechState().status).toBe("loading");
});
it("cancels work by terminating the worker", () => {
  startLocalSpeech("Hello");
  const worker = FakeWorker.instances[0];
  stopLocalSpeech();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(getLocalSpeechState().status).toBe("idle");
});
it("ignores stale results after a newer request", () => {
  startLocalSpeech("First");
  const old = FakeWorker.instances[0];
  startLocalSpeech("Second");
  old.onmessage?.({ data: { type: "error", message: "stale" } });
  expect(getLocalSpeechState().status).toBe("loading");
});
it("reports model errors without falling back to cloud speech", () => {
  startLocalSpeech("Hello");
  FakeWorker.instances[0].onmessage?.({
    data: { type: "error", message: "download unavailable" },
  });
  expect(getLocalSpeechState()).toEqual({
    status: "error",
    error: "download unavailable",
  });
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it("times out a stalled download or inference", () => {
  vi.useFakeTimers();
  startLocalSpeech("Hello");
  vi.advanceTimersByTime(180_000);
  expect(getLocalSpeechState().status).toBe("error");
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it.each(["", "a".repeat(4001)])("rejects empty or oversized input", (text) => {
  startLocalSpeech(text);
  expect(FakeWorker.instances).toHaveLength(0);
  expect(getLocalSpeechState().status).toBe("error");
});

function mockPlayback(play = vi.fn(async () => {})) {
  class FakeAudio {
    static instances: FakeAudio[] = [];
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    pause = vi.fn();
    play = play;
    constructor(public src: string) {
      FakeAudio.instances.push(this);
    }
  }
  const OriginalURL = URL;
  class FakeURL extends OriginalURL {
    static createObjectURL = vi.fn(() => "blob:local-speech");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", FakeURL);
  return { FakeAudio, FakeURL };
}
const audioPayload = () => ({
  data: {
    type: "audio",
    blob: new Blob([new Uint8Array(48)], { type: "audio/wav" }),
  },
});
it("releases inference memory before playback and revokes the URL on completion", async () => {
  const { FakeAudio, FakeURL } = mockPlayback();
  startLocalSpeech("Hello");
  const current = FakeWorker.instances[0];
  await current.onmessage?.(audioPayload());
  expect(current.terminate).toHaveBeenCalledOnce();
  expect(getLocalSpeechState().status).toBe("playing");
  FakeAudio.instances[0].onended?.();
  expect(getLocalSpeechState().status).toBe("idle");
  expect(FakeURL.revokeObjectURL).toHaveBeenCalledWith("blob:local-speech");
});
it("ignores duplicate audio payloads without leaking players or blob URLs", async () => {
  const { FakeAudio, FakeURL } = mockPlayback();
  startLocalSpeech("Hello");
  const current = FakeWorker.instances[0];
  await current.onmessage?.(audioPayload());
  await current.onmessage?.(audioPayload());
  expect(FakeAudio.instances).toHaveLength(1);
  expect(FakeURL.createObjectURL).toHaveBeenCalledOnce();
});
it("cleans up after blocked playback without an unhandled rejection", async () => {
  const { FakeURL } = mockPlayback(
    vi.fn(async () => {
      throw new Error("NotAllowedError");
    }),
  );
  startLocalSpeech("Hello");
  await FakeWorker.instances[0].onmessage?.(audioPayload());
  expect(getLocalSpeechState().status).toBe("error");
  expect(FakeURL.revokeObjectURL).toHaveBeenCalledOnce();
});
it("catches audio constructor failures and cleans up the created URL", async () => {
  const { FakeURL } = mockPlayback();
  vi.stubGlobal(
    "Audio",
    class {
      constructor() {
        throw new Error("Audio unavailable");
      }
    },
  );
  startLocalSpeech("Hello");
  await FakeWorker.instances[0].onmessage?.(audioPayload());
  expect(getLocalSpeechState().status).toBe("error");
  expect(FakeURL.revokeObjectURL).toHaveBeenCalledOnce();
});
it("does not let an old pending play promise change a new request", async () => {
  let resume!: () => void;
  mockPlayback(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    ),
  );
  startLocalSpeech("Old");
  const pending = FakeWorker.instances[0].onmessage?.(audioPayload());
  startLocalSpeech("New");
  resume();
  await pending;
  expect(getLocalSpeechState().status).toBe("loading");
});
it("keeps a watchdog on a stalled playback promise", async () => {
  vi.useFakeTimers();
  mockPlayback(vi.fn(() => new Promise<void>(() => {})));
  startLocalSpeech("Hello");
  void FakeWorker.instances[0].onmessage?.(audioPayload());
  vi.advanceTimersByTime(180000);
  expect(getLocalSpeechState().status).toBe("error");
});
it.each([null, { type: "audio" }, { type: "audio", blob: new Blob([]) }])(
  "handles malformed worker messages safely: %j",
  async (data) => {
    startLocalSpeech("Hello");
    await FakeWorker.instances[0].onmessage?.({ data });
    expect(getLocalSpeechState().status).toBe("error");
  },
);
