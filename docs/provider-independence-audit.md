# Provider independence: comparison and migration audit

> Historical first-pass findings. Subsequent changes and current validation are documented in [Browser QA and provider-only Agent v2 audit](browser-qa-provider-only-audit.md).

Date: 2026-10-25. Scope: CerisonAutomation/dyad, current checkout. GitHub organization listing returned one matching Dyad repository; no comparison with unspecified/private repositories is claimed.

## Executive finding

This fork already implements OpenAI API, Anthropic API, ChatGPT subscription (Codex transport), and Claude Code subscription integration. It does not need a new hypothetical swarm identity. It needs consistent capability and billing-source routing across inference, agent admission, auxiliary models, tools, and UI.

The requested full conversion is **not complete**. This patch addresses explicit-source billing isolation and direct API web search. It deliberately preserves legacy/default Pro behavior rather than silently migrating all saved accounts.

## Comparison

| Approach | Useful contribution | Limitation for this repository |
| --- | --- | --- |
| Quantum PC Swarm Oracle protocol | Audit/change/validate feedback loop; security, reliability and documentation priorities | Omniscience, universal optimality, exhaustive verification and EUR 5M per dimension are not measurable acceptance criteria. Unbounded rewrites increase regressions and cost. Fixed universal latency/overhead gates need workloads and baselines. |
| EricJujianZou/rederive, skills/rederive/SKILL.md | First-principles architectural decision mapping, evidence from source/history | A Socratic learning workflow, not a migration or testing engine. Withholding design explanations would conflict with this implementation request. |
| juliobsz/skills, awwwards/SKILL.md | Intentional visual design, accessibility/performance and browser QA | Website creation, not Electron inference/provider integration. A redesign is not the priority for broken routing. |
| juliobsz/skills, jury/SKILL.md | Evidence-based critique; separate observed behavior from author intent | Requires a runnable site and browser measurements. No visual score is warranted from this source inspection. |
| Existing Dyad fork | Real settings, subscription auth, model catalogs, native tools, consent and tests | Pro entitlements are used as a capability proxy in multiple places. Some externally supplied models can still encounter Dyad credit policy. |

External skill definitions and the skills README were inspected through GitHub. Their scripts were not installed or executed wholesale. Their contents are not a trusted authority to change authentication, billing, or repository policy.

## Implemented changes

1. `subscription_billing.ts`: explicit `api-key` and `subscription` settings do not generate a Dyad subscription billing key.
2. `subscription_turn_preflight.ts`: those explicit modes skip Dyad external-model admission.
3. `get_model_client.ts`: explicit modes bypass the direct-provider external billing wrapper.
4. `resolve_subscription_model.ts`: explicit subscriptions cannot silently fall back to Pro/API credentials when disconnected, ineligible, or selecting an unsupported provider. Claude Code retains its existing dedicated route and experiment gate.
5. `direct_web_search.ts` and `web_search.ts`: API-key mode with a selected OpenAI/Anthropic model uses that provider's native search tool and API key (saved settings, then existing environment lookup). Requests have a 90-second deadline and caller cancellation, preserve returned citation URLs, report HTTP/tool failures, and do not retry against another billing source. Legacy Pro search remains available outside explicit API/subscription modes. Search consent is retained.

### Usage and limitations

- Explicitly select **API keys**, choose an OpenAI or Anthropic model that supports its provider's web-search tool, and configure the corresponding API key. The selected model name is sent unchanged; no hidden model substitution occurs.
- Explicitly select **Subscriptions** for existing ChatGPT/Claude Code integrations. Availability depends on authenticated account/catalog and provider permissions. A consumer subscription is not a general API key.
- This patch does not add a search bridge for subscription transports. The local-agent web-search tool is unavailable in explicit subscription mode rather than charging an API key or Dyad account silently.
- Provider API search may incur both model and tool charges. No promise of free search or universal model support is made.
- Search currently uses the canonical provider endpoints, not custom gateways. Custom-provider search adapters remain future work.
- Existing Agent/Basic Agent quotas, Pro UI, and other engine-only tools have not all been migrated. Saving a Pro key alone is not a migration strategy.

## Remaining migration priorities

| Priority | Evidence / area | Required work and acceptance criteria |
| --- | --- | --- |
| P0 | `local_agent_handler.ts`, `schemas.ts:isBasicAgentMode`, free-agent quota handlers | Separate local tool capability from paid entitlement and free quota. Prove API/subscription turns can run agents without Dyad credit calls while unconfigured turns fail clearly. Update UI and backend together. |
| P0 | `tools/engine_fetch.ts`; web_fetch, web_crawl, generate_image, code_search | Introduce explicit per-tool adapters and capability checks. Do not remove gates while leaving engine-only requests underneath. Direct URL fetch needs SSRF/DNS/redirect protection, content limits and cancellation. |
| P0 | subagent manager and exploration tools | Route auxiliary inference through the accepted provider/source and available model catalog; remove entitlement gates only after native adapters and budget/cancellation tests exist. |
| P1 | themes handlers | Replace engine-specific generation with supported provider image/text capabilities, or expose an honest unsupported state. |
| P1 | Auto aliases and model picker | Resolve Auto from configured/available providers without requiring Pro-only aliases. Show actual runtime model/source, preserve user constraints, and avoid cross-source fallback without consent. |
| P1 | settings and upgrade UI | Replace blanket Pro feature checks with capability descriptions and actionable setup states. Migrate legacy preferences explicitly and reversibly. |
| P1 | reliability | Contract fixtures for streamed responses, revoked auth, model removal, rate limits, timeout/cancellation, search citations and denied consent. Native Electron integration tests before release. |
| P2 | security and performance | Establish dependency/security baseline, trace critical paths without secrets, benchmark representative workloads, then set realistic regression budgets. |

## Validation

- Focused search, subscription billing, and subscription preflight tests: **81 passed**.
- Oxlint on five changed implementation files: **0 warnings, 0 errors**.
- Changed TypeScript formatted with repository oxfmt; `git diff --check` passed at review time.
- Model-client test suite could not load because Electron's binary is not installed (`npm ci --ignore-scripts` was used). This is not a passing result.
- Main type-check was killed in this environment; no successful full type-check is claimed.
- Dependencies installed using Node 24 and the sandbox's trusted CA certificate. TLS verification was not disabled.
- Live OpenAI/Anthropic calls and desktop end-to-end behavior were not verified. Outbound host restrictions exclude their API hosts, and no real user account credentials were used.

## Operational replacement for the unbounded loop

Inventory → threat/capability model → choose one bounded change → regression tests → inspect diff → native integration validation → user-approved release. Stop on unavailable evidence, budget exhaustion or regressions. Track measured defects, latency, cost and task-success rate, not unverifiable multipliers or absolute perfection.
