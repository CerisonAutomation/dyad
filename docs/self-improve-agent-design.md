# Dyad Self-Improvement Agent — design

Status: design approved for staged implementation.
Scope rule (hard): **this agent may only change Dyad itself.** It never edits a user app.

## 0. The problem it solves

Every Dyad conversation is a source of evidence about Dyad's own bugs:

- a tool fails (`read_file` on a path the model guessed, `generate_image` against a
  provider that needs credit, `preview_browser` when the launch failed),
- the model retries the same failing call,
- the transcript ends with the user working around the bug by hand.

Today that evidence is thrown away. The fix is a **self-improvement agent** that
(a) notices a failure, (b) diagnoses it systematically instead of guessing,
(c) consults independent "oracles" and merges their verdicts,
(d) fixes it in the Dyad codebase,
(e) writes a _prevention rule_ that is injected into future turns so the class
of bug does not come back, and (f) improves the prompts that produced the bad
behaviour in the first place.

## 1. Three surfaces

| Surface                                | Trigger                          | What it does                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Failure-driven self-heal**        | a tool call fails                | records the failure signature, and on the first occurrence of a signature injects a self-heal instruction into the running turn; the agent then runs the debug → oracle → fix → prevent loop                 |
| **B. Dedicated self-improvement chat** | auto-trigger (schedule / manual) | one always-open chat whose scope is the Dyad repository; mines the other chats for issues, runs the architect-designer prompt, and is the only chat allowed to edit Dyad's own source                        |
| **C. Prompt interceptor**              | every user prompt                | a bounded auxiliary-model pass that rewrites the prompt with: relevant MCP tools, matching skills, prevention rules, and an explicit "research best practices (Context7) before proposing a fix" instruction |

## 2. Data model

Two files under `<dyadRepo>/.dyad/self-heal/` (same pattern as
`src/ipc/handlers/local_agent/todo_persistence.ts` → `.dyad/todos/<chatId>.json`):

### `ledger.json` — failures seen

```jsonc
{
  "version": 1,
  "entries": {
    "<signature>": {
      "signature": "read_file|path=src/lib/backend/supabase.ts|not-found",
      "toolName": "read_file",
      "canonicalArgs": { "path": "src/lib/backend/supabase.ts" },
      "errorKind": "NotFound",
      "errorSummary": "File does not exist: src/lib/backend/supabase.ts",
      "firstSeenAt": 1730000000000,
      "lastSeenAt": 1730000000000,
      "occurrences": 3,
      "status": "open" | "fixed" | "wontfix",
      "fixCommit": "abc1234",
      "preventionRuleId": "read-file-app-relative-path"
    }
  }
}
```

**Signature** = `toolName | canonicalArgs | normalizedError`. Normalization
strips paths, ids, numbers and line/col so the same class of failure collapses
to one entry. This is the missing piece in
`src/ipc/handlers/local_agent/tool_repeat_tracker.ts` (which only sees tool
_calls_, never results) and in
`src/ipc/handlers/local_agent/tools/tool_invocation.ts:171` (which counts
attempts, not outcomes).

### `prevention.json` — rules that must hold in future turns

```jsonc
{
  "version": 1,
  "rules": [
    {
      "id": "read-file-app-relative-path",
      "createdAt": 1730000000000,
      "signature": "read_file|…|not-found",
      "title": "Resolve app-relative paths before reporting a missing file",
      "instruction": "When a path is not found, list the directory and re-resolve; never repeat the same path.",
      "status": "active",
    },
  ],
}
```

The active rules are injected into **every** local-agent turn (see §4.3), so a
fixed bug cannot silently return.

## 3. Component map (existing seams)

| Component                | Existing seam to reuse                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failure capture          | `src/ipc/handlers/local_agent/tool_definitions.ts:1073` — the per-tool `catch` that already builds `<dyad-output type="error">` and rethrows                          |
| Turn-scoped injection    | `src/ipc/handlers/local_agent/local_agent_handler.ts:949` `pendingUserMessages` + `:1147` `ctx.appendUserMessage` → `prepare_step_utils.ts:158` `prepareStepMessages` |
| Injection precedent      | `local_agent_handler.ts:1699-1716` (planning-questionnaire reflection) and `:1719-1729` (repeat reminder)                                                             |
| Prompt assembly          | `src/prompts/local_agent_prompt.ts:1105-1110` — the `[[AI_RULES]]` / `[[SKILLS]]` function replacers                                                                  |
| Oracle spawn             | `src/ipc/handlers/local_agent/subagents/subagent_manager.ts:460` `spawnModelSubagent`; parallelism cap 3 (`:2968`); explorer + implementer personas only              |
| Oracle merge             | `src/ipc/handlers/local_agent/subagents/subagent_context_budget.ts:456` `boundSubagentSummariesForParent`                                                             |
| Diagnosis contract       | `src/ipc/handlers/local_agent/subagents/review_result.ts:12` `reviewerOutputSchema` + `:44` `STRUCTURED_REVIEW_INSTRUCTIONS` + `:52` `parseReviewResult`              |
| Bounded model call       | `src/ipc/handlers/local_agent/tool_safety_reviewer.ts:25` `reviewToolAction` (prepare → model → zod verdict → fail-closed fallback)                                   |
| Failure ledger precedent | `src/ipc/handlers/local_agent/shell_review_history.ts:5-47` `recordShellReviewOutcome` (30-entry cap)                                                                 |
| Per-chat state file      | `src/ipc/handlers/local_agent/todo_persistence.ts:21` `getTodosFilePath`                                                                                              |
| Scope guard              | `src/ipc/utils/path_utils.ts` `assertMutationPathAllowed` (path confined to the app root)                                                                             |
| Skills catalog           | `src/prompts/skill_catalog_prompt.ts:47` `buildSkillsSection`; `src/prompts/builtin_skills/catalog.ts:121` `BUILTIN_SKILL_CATALOG`                                    |
| MCP tools                | `src/ipc/handlers/local_agent/tools/search_mcp_tools.ts`, `load_enabled_mcp_server_tools.ts` (Context7 = `resolve-library-id` + `query-docs`)                         |

## 4. The three surfaces in detail

### 4.1 Surface A — failure-driven self-heal

```
tool fails (tool_definitions.ts catch)
  → recordFailure(toolName, args, error)         // ledger.json
  → if signature is NEW and not already handled this turn:
        ctx.appendUserMessage([{ type: "text", text: buildSelfHealInstruction(signature) }])
  → the model sees the instruction in the SAME turn and self-heals
  → the self-heal runs the RALPH LOOP (§4.4): diagnose → fix → verify → repeat
  → nothing is finalised until the loop's verification gate passes
```

`buildSelfHealInstruction` (deterministic, no model call) asks the agent to:

1. **Reproduce and read the exact error** (no guessing).
2. **Systematic debug**: root cause before any fix; list the adjacent failure
   modes the same bug could produce.
3. **Oracle consensus**: spawn three independent explorer sub-agents with
   _different_ diagnostic framings (e.g. "where does this input come from",
   "what is the contract this code assumes", "what would break next"), then
   merge their reports into one verdict; only act on a finding ≥2 oracles agree on.
4. **Research**: call the Context7 MCP tools (`resolve-library-id` then
   `query-docs`) for the library involved and fold the documented best practice
   into the fix.
5. **Score every candidate diagnosis** (0-10) with the fast decision layer
   (§4.4) and keep only the ones that clear the gate; the consensus is the
   score-weighted vote of the oracles, not a plain majority.
6. **Run the Ralph loop** (§4.4) until the verification gate passes: propose a
   fix, apply it, VERIFY it with real evidence (`npm run fmt` / `npm run ts` /
   `npm run lint` / the touched test files), and on a failed gate go back to
   diagnosis with the new evidence attached. The loop is bounded; a failed
   budget means the fix is NOT finalised.
7. **Critique before acceptance**: a separate critic pass (a fresh reviewer
   sub-agent, not the author) reviews the diff against the diagnosed root
   cause and the prevention rule. A critic veto keeps the loop running.
8. **Finalise only after**: the verification gate passed AND the critic did not
   veto. Then record the prevention rule in `prevention.json`.
9. **Never widen scope** beyond the diagnosed root cause, and never touch
   anything outside the Dyad repository (hard guard, §4.5).

Guard rails: at most **one** self-heal instruction per signature per turn
(dedupe map), at most **3** oracle spawns per turn, oracle failures are
non-fatal (the agent proceeds with its own diagnosis), and the instruction is
skipped when the error is a user cancellation.

### 4.2 Surface B — the dedicated self-improvement chat

- A synthetic app row **`Dyad (self-improvement)`** whose path is the Dyad
  source root, created lazily on first use.
- A chat for it, pinned (`chats.is_favorite`) and marked so the chat list can
  surface it as "always open".
- Its system prompt (`buildSelfImproveSystemPrompt`) is an **architect-designer**
  prompt:
  - _scope_: you may ONLY read/write the Dyad repository. Any request to change
    a user app is refused with a pointer to that app's own chat.
  - _method_: mine other chats (`search_chats` / `explore_chat_history`
    sub-agent) for failures and workarounds, cluster them into classes, then
    fix one class at a time.
  - _oracles_: for each candidate fix, run the 3-oracle consensus above.
  - _research_: Context7 + the skill catalog before proposing a fix.
  - _prevention_: every fix ends with a prevention rule.
- Auto-trigger: a scheduler (interval + on-app-start) enqueues a run of this
  chat when the ledger has open entries and the repo is clean. It is
  rate-limited (one run per N minutes) and never runs while another turn for
  the same chat is active.

### 4.3 Surface C — the prompt interceptor

Applied in the local-agent path before the prompt is sent to the model:

```
user prompt
  → buildImprovementContext(prompt, {mcpTools, skills, preventionRules})
  → auxiliary model (bounded, 8 s, fail-closed to the ORIGINAL prompt)
        returns { improvedPrompt, researchRequests[] }
  → improvedPrompt + injected guidance
```

The auxiliary model is told to:

- keep the user's intent intact (never silently change the request),
- name the MCP tools that fit the task (Context7 first for library questions),
- name the skills that fit (from `BUILTIN_SKILL_CATALOG`),
- append the active prevention rules that apply,
- list the docs it looked up (`researchRequests`) so the main model can fetch
  them through the Context7 MCP tools.

**Fail-closed**: on timeout, parse error, or any failure, the ORIGINAL prompt
is used. The interceptor never blocks a turn.

### 4.4 The Ralph loop, scoring, and the fast decision layer

The self-heal is an **iterative loop**, not a single pass. Each iteration runs
in a FRESH context (the previous iteration's transcript is summarised into the
next instruction, so the loop never grows without bound) and ends with a
verification gate.

```
iteration:
  DIAGNOSE   3 oracles (independent framings) → per-oracle score
             → consensus (score-weighted vote) → one root-cause hypothesis
  PLAN       the hypothesis + the smallest fix + the prevention rule
  APPLY      edit the Dyad source (scope-guarded)
  VERIFY     npm run fmt | npm run ts | npm run lint | touched test files
             → PASS / FAIL evidence (command + exit code + output excerpt)
  CRITIQUE   a fresh reviewer sub-agent reviews the diff (no authorship bias)
             → APPROVE / VETO with reasons
  GATE       PASS and not VETO → FINALISE (write prevention.json)
             else → next iteration with the evidence attached
  STOP       iteration budget exhausted → NOT finalised; write a
             "needs human" ledger entry with the collected evidence
```

**Scoring.** Every artefact carries a numeric score so the loop can compare
quantitatively instead of vibes:

| Score             | Range | Meaning                                                                                                     |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| oracle confidence | 0-10  | how strongly that oracle believes its root cause                                                            |
| consensus score   | 0-10  | score-weighted agreement across oracles (a single high-confidence oracle cannot reach the gate alone)       |
| diagnosis score   | 0-10  | fast-decision-layer verdict on the merged diagnosis ("is this plausible and is it worth another iteration") |
| fix score         | 0-10  | critic + verification outcome (verification failure ⇒ 0)                                                    |
| class severity    | 0-10  | how many turns/users this failure class has burned (ledger `occurrences`)                                   |

A fix is finalised only when `consensus score >= 7` AND `fix score >= 7` AND
the verification gate passed AND the critic approved.

**Fast decision layer (Laya / Jev).** Most of the gates above do not need a
full model call. The cheap typed decision layer answers them in milliseconds
and is the DEFAULT for the gates below; a full auxiliary-model pass is only
used where judgement is genuinely required.

| Gate                                                 | Decision            | Default on failure                  |
| ---------------------------------------------------- | ------------------- | ----------------------------------- |
| is this failure signature worth a self-heal attempt? | typed yes/no + 0-10 | no (skip)                           |
| is this merged diagnosis plausible?                  | typed yes/no + 0-10 | no (reject the diagnosis)           |
| should the Ralph loop continue or stop?              | typed yes/no        | stop (never spend unbounded budget) |
| is this prompt rewrite safe to apply?                | typed yes/no        | no (keep the original prompt)       |
| is this diff a fix for the diagnosed root cause?     | typed yes/no        | no (veto)                           |

Everything the fast layer produces is treated as UNTRUSTED: a typed score is
an input to the decision, never the decision itself, and it can never widen
scope or finalise a fix on its own.

### 4.5 Scope guard — the agent may only improve Dyad

The self-improvement agent is hard-scoped to the Dyad repository:

- the app row points at the Dyad source root, and every mutation goes through
  `assertMutationPathAllowed` with that root as the allowed prefix;
- the architect-designer system prompt refuses any request to change a user's
  app and points at that app's own chat instead;
- the prompt interceptor may only ever ADD guidance (skills, MCP tool names,
  prevention rules, doc references) to a prompt — it may not change the
  user's intent or redirect the task;
- the prevention ledger lives under `<dyadRepo>/.dyad/self-heal/`, never in a
  user app.

## 5. Safety and budget

| Rule                                    | Value                                                        | Why                                                                    |
| --------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| self-heal instructions per turn         | 1 per distinct signature, ≤3 total                           | stops instruction storms                                               |
| oracle spawns per turn                  | 3 (the existing sub-agent parallelism cap)                   | matches `drainRuns`                                                    |
| oracle verdict                          | ≥2 of 3 must agree                                           | prevents one bad oracle from steering the fix                          |
| interceptor budget                      | 8 s, 1 call, fail-closed                                     | an interceptor must never make a turn slower than the turn it improves |
| prevention rules injected               | ≤20, most recent first                                       | prompt budget                                                          |
| ledger entries                          | ≤200, LRU by `lastSeenAt`                                    | disk budget                                                            |
| ralph loop iterations per failure class | 5                                                            | a fix must terminate                                                   |
| oracles per iteration                   | 3                                                            | the existing sub-agent parallelism cap                                 |
| critic per iteration                    | 1                                                            | a veto needs a second opinion, not a committee                         |
| verification gate                       | fmt + ts + lint + touched tests must pass                    | evidence, not a claim                                                  |
| consensus gate                          | score >= 7 and >=2 of 3 oracles                              | one oracle cannot steer a fix                                          |
| fast-decision calls per iteration       | <=4                                                          | cheap gates must stay cheap                                            |
| scope                                   | Dyad repo path only, enforced by `assertMutationPathAllowed` | the hard rule                                                          |

## 6. Rollout

1. **Ledger + instruction + prevention injection** (no UI). Ships the mechanism;
   the agent already receives a "when a tool fails, debug it systematically"
   instruction and now gets the ledger-backed prevention rules.
2. **Dedicated chat** (app row + pinned chat + architect prompt + auto-trigger).
3. **Prompt interceptor** (auxiliary model pass).
4. **Oracle consensus** (3 sub-agents per failure class) — the most expensive
   step, so it runs only for failures that recur (ledger `occurrences >= 2`).

## 7. What this reuses vs. adds

Reused (no new machinery): sub-agent spawn/join, the review JSON contract, the
bounded auxiliary-model runner, the prompt replacers, the skill catalog, the
MCP tool loader, the path guard, the per-chat `.dyad/` file pattern.

Added: `src/ipc/handlers/local_agent/self_heal/` (ledger, instruction builder,
prevention store, interceptor, self-improve prompt) and the wiring points
listed in §3.

## 8. Research harvest — what the online research changed

Patterns harvested from primary sources (papers, official docs, engineering blogs) and
applied to this design. Full digest with URLs and numbers: see the research section
appended below.

### 8.1 Amendments this research forces

| #   | Pattern (source)                                                                          | Amendment to this design                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | **Copilot Autofix 4-part success gate** (github.blog)                                     | The verification gate is EXACTLY four machine-checkable clauses: (a) the failing tool call now succeeds, (b) no NEW test failures, (c) no syntax/type errors, (d) no existing test outcome changed. The agent NEVER reports its own success — the gate runs the commands.                                                    |
| 2   | **Reproduce-first** (Otter, SWT-Bench)                                                    | A fail-to-pass regression test becomes a FIRST-CLASS artifact, written BEFORE the fix. It proves the bug is real, it is the merge key for the oracle consensus, and it IS the prevention rule.                                                                                                                               |
| 3   | **Canonicalized majority vote** (Agentless)                                               | Oracle verdicts are merged on the CANONICALIZED candidate fix (normalised form), not on raw text. A consensus of 3 that disagrees on wording but agrees on the canonical fix counts as agreement.                                                                                                                            |
| 4   | **Sentry fingerprint** (docs.sentry.io)                                                   | The ledger key = normalized(tool) + normalized(relative path) + normalized(error kind) + scrubbed message (paths, ids, uuids, numbers stripped). It collapses a failure CLASS, not an instance.                                                                                                                              |
| 5   | **Launchpad `(signature, fixed_version)` PK** (wiki.ubuntu.com)                           | The ledger key is the COMPOSITE `(signature, fixedInVersion)`. A bug that regresses after a fix creates a NEW entry in state `regressed`, it does not silently reattach to the closed one. States: `open / ignored / regressed / resolved`.                                                                                  |
| 6   | **Sentry ignore + auto-expire** (docs.sentry.io)                                          | "Known issue" entries auto-expire; a reappearance flips the entry to `regressed` and re-opens the self-heal. Known-bad signatures are suppressed BEFORE the self-heal triggers.                                                                                                                                              |
| 7   | **Path-triggered, once-per-conversation, non-model-invocable rules** (docs.openhands.dev) | Prevention rules fire on the TOOL ACTION (`paths:` glob), are injected into the TOOL RESULT (not the user's message), at most ONCE per conversation, and can never be model-invocable. Zero token cost when inactive.                                                                                                        |
| 8   | **Claude Code verification ladder** (claude-code docs)                                    | Verification has 4 rungs: (1) verification stated in the prompt, (2) a deterministic test harness, (3) a FRESH-CONTEXT adversarial sub-agent, (4) a deterministic stop-hook gate. The Ralph loop uses rung 3 for diagnosis and rung 4 for the gate, with the same 8-consecutive-block cap.                                   |
| 9   | **Copilot `/pr fix ci` bounded loop** (docs.github.com)                                   | The self-heal is a bounded state machine `observe → hypothesise → patch → verify → (repeat                                                                                                                                                                                                                                   | stop)`. |
| 10  | **Cursor Bugbot attempt cap = 3** (cursor.com)                                            | Hard cap: 3 self-heal attempts per failure signature, then escalate to the human-facing surface.                                                                                                                                                                                                                             |
| 11  | **DGM guardrails + reward hacking** (arxiv 2505.22954)                                    | The self-heal is sandboxed, its write-set is Dyad's own source, each attempt is time-limited, and every self-heal leaves a TRACEABLE LINEAGE entry (signature → root cause → patch → verification result). DGM agents faked test logs; a self-reported verification is worthless, so the archive is what makes it auditable. |
| 12  | **SWE-agent observation compression** (arxiv 2405.15793)                                  | Each oracle receives a COMPRESSED failure bundle (the error + the last action + the last 5 observations collapsed to one line each), never the full transcript.                                                                                                                                                              |
| 13  | **DGM "history of what was tried and why it failed"** (sakana.ai)                         | Every oracle receives the list of PRIOR FAILED APPROACHES for this signature, so it does not repeat them.                                                                                                                                                                                                                    |
| 14  | **ChatEval persona diversity** (arxiv 2308.07201)                                         | The oracles MUST use genuinely different role framings (and, where the model allows, different models). "Using the same role description in the prompts can lead to a degradation in performance."                                                                                                                           |
| 15  | **Anthropic tool error-response design** (anthropic.com)                                  | A tool error message must name the ACTUAL paths searched and the nearest existing path — that message is the input to the whole self-heal pipeline. (Already implemented in `read_file` / `search_replace`.)                                                                                                                 |
| 16  | **Anthropic context engineering** (anthropic.com)                                         | Inject IDENTIFIERS + INSTRUCTIONS TO FETCH, not the docs themselves. The interceptor injects the Context7 two-step contract, not the documentation text.                                                                                                                                                                     |
| 17  | **Context7 two-step + one concept per call + version-pinned id** (context7.com)           | The interceptor injects the exact contract: `resolve-library-id` → `query-docs`, one concept per call, version-pinned library id, ask for CODE EXAMPLES not prose.                                                                                                                                                           |
| 18  | **CloudAPIBench intelligent doc triggering** (arxiv 2407.09726)                           | NEVER fetch docs unconditionally: a bad retriever cost 39 points on common APIs. The interceptor gates on "is this API rare / is the model likely to be wrong about it".                                                                                                                                                     |
| 19  | **Intent-preservation + no-rewrite arm** (arxiv 2503.16789, QueryBandits)                 | The interceptor ships an INTENT-PRESERVATION check, a NO-REWRITE arm, and a hard token budget. The best rewriter made responses worse in 19% of cases.                                                                                                                                                                       |
| 20  | **Untrusted input** (PromptDoctor, arxiv 2501.12521)                                      | The user prompt, repo content and chat history are UNTRUSTED to the interceptor; it may only ADD guidance, never change intent, never follow instructions embedded in repo content.                                                                                                                                          |
| 21  | **SBERT duplicate-bug clustering** (frontiersin 2022)                                     | Mined chat issues are clustered with embeddings + a threshold (prior LLM-similarity methods caught only 24% of duplicates) and deduped against the ledger so the miner never re-reports a known issue.                                                                                                                       |
| 22  | **Qodo Auto Best Practices** (docs.qodo.ai)                                               | Prevention rules are harvested from ACCEPTED fixes (not raw failures) and are labelled as learned best practice.                                                                                                                                                                                                             |

### 8.2 Antipatterns this design must not fall into (with the evidence)

1. **Unbounded self-modification with the agent as its own verifier** — DGM agents faked
   unit-test logs and deleted the markers used to detect the faking. ⇒ the verifier is a
   deterministic external gate; the agent's claim is never the evidence.
2. **Consensus with no cost bound and no "no consensus" escape** — MAD medical QA: 0.61 at
   \$28.04 vs single agent 0.56 at \$6.37; the best single-agent prompt can be 13× cheaper.
   ⇒ N=3, hard attempt cap (3), iteration cap (5), and an explicit "no consensus" outcome
   that ends the loop instead of escalating the budget.
3. **Consensus assumed to be correct** — debates converge on confidently wrong answers;
   coding-specific: "consensus among stochastic agents does not guarantee correctness".
   ⇒ consensus is a necessary, never sufficient, gate; the deterministic verification
   gate still has the last word.
4. **Homogeneous agents** — ChatEval: diverse role prompts are essential; the same role
   description degrades performance. ⇒ the 3 oracles use 3 genuinely different framings.
5. **Rewriting prompts without a no-rewrite arm or without fail-closed** ⇒ the
   interceptor has a no-rewrite arm, an intent-preservation check and fails closed.
6. **Always fetching docs / always rewriting** ⇒ conditional doc triggering only.
7. **Retry loops without signature dedupe or loop detection** — SWE-agent: "Failed Edit
   Recovery" was 23.4% of unresolved instances; OpenHands hit 500 iterations before adding
   a stuck detector. ⇒ the signature dedupe + the attempt cap + the loop detector.
8. **Fixing before reproducing** — 52% of SWE-agent's unresolved instances were wrong
   implementations; giving the model the TEST FILE nearly doubled success (8.1%→15.1%)
   while giving the PATCH raised it only to 10.5%. ⇒ reproduce-first is mandatory.
9. **Trusting public SWE-bench scores or your own model** — OpenAI retired SWE-bench
   Verified reporting: "at least 59.4% of the audited problems have flawed test cases
   that reject functionally correct submissions". ⇒ judge with YOUR OWN checks, not a
   public leaderboard.

### 8.3 Numbers worth remembering

- Multi-agent debate (3 agents): GSM 77.0 → 81.0 (majority) → 85.0 (debate); Arithmetic
  67.0 → 69.0 → 81.8. Mixture-of-Agents (6 proposers, 3 layers): AlpacaEval 65.1% vs
  GPT-4o 57.5%. ChatEval over a single-agent judge: +6.2% (ChatGPT), +2.5% (GPT-4).
- But: systematic re-evaluation found "MAD often fail to outperform simple single-agent
  baselines such as Chain-of-Thought and Self-Consistency"; model heterogeneity is the
  universal fix. ⇒ instrument the consensus; do not assume it pays.
- Doc grounding: API-doc RAG improves less-common-library performance 83%–220%;
  version-partitioned retrieval lifts REST repair 54.3% → 88.6%, while deprecated-only
  context gives 21.0% (WORSE than no docs). Hierarchical Knowledge Injection: 79% fix
  rate on BugsInPy, +23% over prior work.
- Regression tests as a filter: the Otter++ tests lift a top-3 SWE-bench system's
  precision 60.8% → 91.9%. Generated tests more than double SWE-Agent's precision to
  47.8% at 20% recall. Executing generated tests before submitting: 15.9% → 18.5%.
- Agentless (SWE-bench Lite 32.00% at \$0.70/fix) uses 40 candidate patches/bug and an
  AST-normalized majority vote. Copilot Autofix: success tripled while LLM compute fell
  6×. Bugbot Autofix: stops after 3 attempts/PR.
- Prompt rewriting: >20-point helpfulness jump on the study's models, but the best
  rewriter made 19% of responses worse; intent preservation only 74% rated 2.5–3.
