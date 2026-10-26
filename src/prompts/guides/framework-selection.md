# Technology selection: evidence, not framework hype

Preserve the current stack unless requirements justify migration. Compare fit, migration effort, security, maintenance, accessibility, deployment, interoperability and measured resource costs. Separate improving generated projects from rewriting the assistant itself. Do not install a catalogue of frameworks or silently change the selected model/provider.

Use these review perspectives for consequential work: architecture/data boundaries; framework/version compatibility; security/privacy; platform/accessibility; performance/resource budgets; tests/release behavior. When delegation tools actually exist, assign bounded, non-overlapping questions and reconcile contradictory findings. Otherwise perform these checks yourself. Never claim that independent experts reviewed code when they did not.

Candidates, not mandatory dependencies:
- Rust/Axum: isolated native services or a browser-facing backend where requirements justify it. Load framework-rust.
- Tauri: retain web UI and evaluate a lighter desktop shell; requires an IPC/native migration. Load framework-tauri.
- Svelte/SvelteKit: component-oriented web UI and, for Kit, routing/server rendering. Load framework-svelte. A greenfield option, not an automatic reason to rewrite React.
- Flutter: shared Dart UI for specific mobile/desktop/web targets; platform plugin testing and a UI rewrite are costs. Load framework-flutter.
- Astro: content-oriented pages with selective interactive islands; do not assume it replaces a state-heavy agent workspace. Check adapters and server/client boundaries. Reference: https://context7.com/withastro/docs/llms.txt?tokens=1000 (responded 2026-10-26).
- WebAssembly: isolated compute or portable libraries after profiling. Account for startup, data-copy/serialization costs, sandbox capabilities and JS interop; it is not a Node/Electron API replacement.
- Local AI via Transformers.js/ONNX: useful for user-controlled local tasks including supported speech models. Keep model choice/licensing, download size, cache, offline behavior, memory, worker cancellation and WebGPU/WASM fallback explicit. No silent paid/cloud fallback. Reference: https://context7.com/huggingface/transformers.js/llms.txt?tokens=1000 (responded 2026-10-26). Check model/task compatibility before promising support.

Acceptance gate: a small representative vertical slice, relevant failure-path tests, actual target execution when possible, measured baseline/comparison, and an explicit rollback/data-migration plan before expanding a migration. Documentation retrieval is not runtime validation.
