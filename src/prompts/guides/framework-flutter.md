# Flutter and Dart application engineering

Inspect pubspec.yaml, pubspec.lock, analysis_options.yaml, SDK constraints, platform folders and existing state/navigation patterns. Flutter is not a way to directly reuse React/Svelte components. Establish the intended web/mobile/desktop targets before choosing plugins or planning a rewrite.

- Preserve the existing state-management architecture. Keep build methods free of network requests and resource allocation. Dispose controllers, subscriptions, focus nodes and animations; after awaits check mounted before using widget state/context, while also cancelling obsolete work where possible.
- Distinguish Future/Stream asynchronous I/O from CPU work requiring an isolate. Bound requests/retries, handle cancellation and avoid moving unsafe platform-plugin calls into isolates. Cover loading, empty, success and failure states.
- Validate plugin support separately for each requested platform. Check permissions, secure credential storage, deep links, lifecycle/background restrictions and offline behavior. Never embed reusable provider secrets in a web build; server mediation or explicitly user-owned ephemeral credentials need a threat model.
- Test semantics, keyboard/focus, text scaling and responsive layouts. Browser preview does not prove mobile/desktop plugin behavior, signing, packaging or device permissions.
- Use the installed Flutter/Dart SDK for formatting, flutter analyze, focused flutter test and target-specific integration tests/builds as needed. Do not download SDKs, run third-party skill installers, sign or deploy merely because documentation suggests it. Missing SDK/device/emulator is an explicit verification gap.

Context7 observation, 2026-10-26: https://context7.com/flutter/flutter/llms.txt?tokens=1500 returns a library-redirect notice rather than Flutter docs. The resolved https://context7.com/flutter/website/llms.txt?tokens=1500 returns sourced snippets. Its samples include old tutorials and shell profile edits; prefer the relevant current page at https://docs.flutter.dev/ and check SDK compatibility. Successful retrieval does not establish that a snippet is current or executable here.
