import { RawAudio } from "@huggingface/transformers";
import { splitSpeechText } from "./text";
import { KokoroTTS } from "kokoro-js";

// Apache-2.0 Kokoro, ONNX inference via Transformers.js in a dedicated worker.
self.onmessage = async (event: MessageEvent<{ text: string }>) => {
  try {
    const text = event.data.text;
    if (!text.trim() || text.length > 4000)
      throw new Error("Local speech accepts 1–4000 characters at a time.");
    const tts = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      {
        dtype: "q8",
        device: "wasm",
      },
    );
    const chunks: Float32Array[] = [];
    let length = 0;
    for (const chunk of splitSpeechText(text)) {
      const audio = await tts.generate(chunk, { voice: "af_heart" });
      chunks.push(audio.audio);
      length += audio.audio.length;
      if (length > 24000 * 600)
        throw new Error("Local speech exceeded the ten-minute audio limit.");
    }
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const audio = new RawAudio(samples, 24000);
    self.postMessage({ type: "audio", blob: audio.toBlob() });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Local speech failed",
    });
  }
};
