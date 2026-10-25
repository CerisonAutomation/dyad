# Coding quality upgrade — 2026-10-25

## Shipped changes

- Added a bounded, provider-neutral coding quality contract to local Agent, build Agent and delegated implementer prompts. It requires observable acceptance criteria, repository/version inspection, minimal coherent changes, relevant edge cases and UI/accessibility checks, evidence-based recovery and honest completion reports. Read-only and delegated ownership boundaries have separate instructions.
- Replaced unused exported reasoning-transcript guidance with private reasoning / concise public plan guidance. This constant has no current runtime consumers; this cleanup alone does not change active inference.
- Automatic helper inference now inherits the accepted selection instead of choosing a fixed helper model. API-key and provider-account normalization remain explicit. Missing models and obsolete application-credit selections fail closed.
- Removed hardcoded fallback arguments from safety review, prompt improvement, exploration, durable personas and compaction. Compaction no longer selects a paid-only pinned model. Persona preflight validates the selected client instead of requiring a fixed model in a paid catalog; accepted effort settings are preserved.
- Newly created persona thread metadata records the configured selection instead of fixed persona model labels. Model-invoked threads receive the accepted root settings snapshot. This records the requested selection, not proof of the eventual resolved Auto model or provider-side execution.
- Added quality-contract tests to the repeatable `npm run qa:agent2` gate and a scoped `scripts/qa/tsconfig.coding-quality.json` typecheck.

These are instruction and routing improvements, not measured gains in generated-code correctness. Prompt inclusion tests cannot prove model compliance. Existing source/permission checks remain necessary.

## Current primary-source review

Read pinned sources rather than executing third-party installers or copying a whole agent prompt:

- [OpenAI Codex prompt](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/gpt-5.2-codex_prompt.md), commit 2026-10-23: targeted code search, proportional planning, repository conventions, severity/evidence-oriented review and concise verification reports.
- [Anthropic Claude Code README](https://github.com/anthropics/claude-code/blob/2eff7a8d21c80be48904f62ebdea36d945d7b504/README.md), commit 2026-10-25: current product/install context only; not an independently reviewed implementation of its agent loop.
- [Vercel AI SDK tool calling](https://github.com/vercel/ai/blob/20c4031d1fc59aab54b67c16679e3981374690ab/content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx) and [testing](https://github.com/vercel/ai/blob/20c4031d1fc59aab54b67c16679e3981374690ab/content/docs/03-ai-sdk-core/55-testing.mdx), commit 2026-10-25: bounded tool steps and repeatable mock-provider tests. Crucial compatibility distinction: current main documentation demonstrates V4 mock models, while this checkout installs `ai@6.0.315`. Do not paste latest-main API examples into this version without checking compatibility. No SDK major upgrade was attempted.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60), previously inspected: bounded goals, cancellation and recovery informed the quality policy; no third-party plugin code was executed for this change.

The contract is independently written. Research did not add dependencies or grant tools new permissions.

## Executed verification

- `qa:agent2`: **659 tests passed across 41 targeted files** after final code changes. Includes routing, model factory, safety review, prompt construction, discovery and existing browser-adapter coverage. Not whole-app coverage.
- Scoped coding-quality `tsgo` check: **passed**, including helper and contract tests. Initial fixture casts and missing Vite ambient types were corrected before rerunning.
- TypeScript syntax transpilation: **passed** for durable subagent manager and compaction handler; this is explicitly not a full typecheck of those native-runtime graphs.
- Chromium preview smoke: **passed** for Settings, Library, Templates and Apps; visible rendering/navigation, read-only rejection and no uncaught page errors. It uses the existing read-only browser preview, not native Electron inference.
- `git diff --check`: **passed**.

Detailed execution logs are workspace files `/home/user/coding-quality-regression-final.log`, `/home/user/coding-quality-types.log` and `/home/user/coding-quality-browser.log`, not committed datasets.

## Remaining evidence gates

No financial valuation, production-readiness claim, live model benchmark, provider-billing verification or end-to-end native subagent/compaction execution is established here. Native dependency limitations from the broader audit remain. No claim of complete commercial-system removal is made; see `agent2-aggressive-audit.md` for remaining migration work.

To measure coding quality rather than prompt wording, the next evaluation should compare the same pinned task set and model settings before/after: hidden functional tests, scoped diff review, security/accessibility regressions, completion rate, retries, token cost and latency. Keep deterministic mock-provider tests separate from credentialed live-provider evaluation and record all failures. Such a benchmark has not been run in this session.
