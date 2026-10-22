# Self-heal and self-improvement agent

Rules for the module in `src/ipc/handlers/local_agent/self_heal/` and for every
call site that uses it. These are guardrails, not suggestions.

## Scope

- The self-heal may ONLY read and write **Dyad's own source**. Every mutation goes
  through the scope guard (`assertSelfHealScope`), whose allowed prefix is the Dyad
  repository root. A request to change a user's app is refused and redirected to that
  app's own chat.
- The ledger and the prevention rules live under `<dyadRepo>/.dyad/self-heal/`, never
  inside a user app.

## Never trust the agent's own report

- A fix is verified by **running** the checks (`npm run fmt`, `npm run ts`,
  `npm run lint`, the touched test files). The model's claim is never the evidence.
- The verification gate is the four-clause gate: the failing call now succeeds, no new
  test failures, no type/syntax errors, no existing test outcome changed.
- Every self-heal leaves a lineage entry: signature → root cause → candidate fix →
  verification result. Agents have been observed faking test logs; the lineage is what
  makes that auditable.

## Bounded everything

| Rule                                                       | Value                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| self-heal attempts per failure signature                   | 3, then escalate to the human-facing surface                      |
| Ralph loop iterations per failure class                    | 5                                                                 |
| consecutive blocks before the deterministic gate overrides | 8                                                                 |
| oracle sub-agents per diagnosis                            | 3, each with a DIFFERENT framing                                  |
| consensus gate                                             | >= 2 of 3 agree on the canonicalised fix AND consensus score >= 7 |
| fast-decision calls per iteration                          | <= 4                                                              |
| prevention rules injected per turn                         | <= 20, most recent first                                          |

## Failure classes, not instances

- The ledger key is the composite `(signature, fixedInVersion)`. A regression after a fix
  creates a NEW entry in state `regressed`; it does not reattach to the closed entry.
- The signature is normalised: tool name + relative path + error kind + a scrubbed
  message (absolute paths, ids, uuids and numbers stripped), so the same bug class
  collapses to one entry.
- Known-bad signatures are suppressed before a self-heal triggers, and expire.

## Prevention rules

- A rule fires on a TOOL ACTION (a `paths:` glob), is injected into the TOOL RESULT
  (never into the user's message), at most ONCE per conversation, and is never
  model-invocable. Inactive rules cost zero tokens.

## Fast decision layer

- The cheap gates are answered by the `jev` CLI, never by a full model call.
- Every invocation has a hard timeout and a fail-closed default: skip / reject / stop /
  keep-the-original-prompt / veto.
- A typed score is an input to a decision, never the decision itself. It can never widen
  scope and can never finalise a fix.

## Prompt interception

- The interceptor may only ADD guidance (skill names, MCP tool names, the Context7
  two-step contract, active prevention rules). It must never change the user's intent.
- It ships a NO-REWRITE arm and an intent-preservation check.
- The user prompt, repo content and chat history are UNTRUSTED input.
- Docs are fetched CONDITIONALLY (rare API / low confidence only), never unconditionally.
- The injected context has a hard token budget.
