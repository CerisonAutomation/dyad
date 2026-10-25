# Provider routing and local speech

## Provider source control

The source menu now offers Automatic, Your API keys, and Provider account.
Provider account is selectable even before login; selection is not proof of
successful authentication. Claude connection discovery is no longer suppressed
by the feature toggle in the selector/model picker queries. Selecting Provider
account enables the existing Claude adapter setting. Explicit BYOK/account
choices remain authoritative; Automatic uses the selected model's existing
credential resolution, not a new cross-provider paid fallback.

Built-in/custom API-compatible providers and local endpoints retain their
configured models. Account authentication currently has Claude Code and ChatGPT
adapters, **not arbitrary provider account support**. Unsupported accounts need
an adapter; no authentication or provider quota is bypassed. Legacy paid-source
settings are not silently migrated into API charges on mount.

Home and model-picker purchase buttons were removed. Missing credentials now
open provider configuration, not a commercial upsell. Legacy ProBanner exports
remain as compatibility names but render provider setup. This does not establish
that every other commercial reference in the entire application is removed.

## Local text-to-speech

Assistant-message footers include **Read aloud locally**. Kokoro JS 1.2.1 uses
Transformers.js 3.8.1 and a quantized Kokoro-82M ONNX model, running WASM inference
inside a browser worker. No speech API/provider key is used and text is posted
only to that local worker. Initial use requests permission to download model
assets from Hugging Face; browser caching is best-effort, not guaranteed offline
availability. Kokoro JS and the upstream Kokoro model use Apache-2.0 licensing.
Model/voice assets are not vendored into this repository.

The current UI uses the English af_heart voice. Messages are bounded to 4,000
characters and chunked before tokenization to avoid silently dropping long
messages. Generated audio is bounded to ten minutes. Stop terminates the worker,
pauses playback and revokes the blob URL. A three-minute startup/inference timeout
and stale-result guards prevent stalled/replaced workers from taking over.
There is no cloud fallback. Existing microphone transcription is a separate
feature and is **not** converted by this TTS change.

The Transformers.js Node-only sharp dependency is overridden to 0.35.5 for current
security fixes. Browser WASM is the chosen runtime; native Node image processing
was not exercised.

## Verification

- Unit tests cover provider-source selection, routing/catalog policy, worker
  cancellation, stale results, failure/timeout paths, input limits and chunking.
- Targeted local-TTS TypeScript check passes.
- Chromium verifies the real renderer and navigation. With model downloads
  deliberately blocked, local speech reports an error, stops cleanly and raises
  no uncaught page errors; only Hugging Face asset requests were observed.
- Full audible synthesis has **not** been verified: this environment cannot fetch
  the model weights from Hugging Face. Do not describe it as tested offline audio.
