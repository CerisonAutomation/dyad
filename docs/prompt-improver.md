# Composer prompt improver

The sparkle **Improve prompt** button is immediately before the microphone in both Home and existing-chat composers. It opens a review dialog rather than sending a chat message.

1. Enter a draft, click the sparkle button, and review the provider-usage disclosure.
2. **Generate improvement** sends only that draft to the selected model (the chat selection in an existing chat, current settings on Home). It does not include files, attachments or conversation history.
3. Edit the proposed prompt if desired, then choose **Apply to draft** or **Keep original**. Applying does not send the message. Concurrent/newer draft edits are protected by both the dialog and an atomic parent-state comparison.

There is no additional service account, Dyad commercial subscription, Python optimizer, or hardcoded model requirement. Existing provider credentials/accounts are used. Provider usage may incur charges. Empty/oversized drafts are disabled. Generation uses one pass, a 12,000-character input bound, 4,096 output-token limit, 16,000-character proposal bound, zero automatic retries, and a 90-second inference timeout. Closing, switching chats, disabling the composer or unmounting cancels the request; late responses are ignored. Cancellation cannot guarantee a provider refunds work already performed.

## Candidate review (2026-10-25)

- [Roo Code Enhance Prompt](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/apps/docs/docs/features/enhance-prompt.md), Apache-2.0: the closest interaction pattern—composer wand, chosen API configuration and reviewable enhanced text. This implementation adds an explicit proposal dialog instead of immediately replacing the original. No upstream code or prompt text was copied.
- [Microsoft PromptWizard](https://github.com/microsoft/PromptWizard/tree/a1d43f876ef4468b0549a3ceff8bd691b80cd667), MIT: richer iterative generation/critique and example optimization; supports no-example, synthetic-example and training-data scenarios. Better suited to a separate optimization workflow than making every composer click run an optimization pipeline. README reviewed, framework not installed or executed.
- [DSPy](https://github.com/stanfordnlp/dspy/tree/15aad8de2678a4d89a3a093e944fe58f8744c497), MIT: programmable language-model systems and optimization of prompts/weights. Useful for an eventual measured task-specific evaluation/optimization pipeline, not a necessary dependency for this single draft-refinement action. README reviewed, framework not installed or executed.

Decision: reuse the app's existing bounded AI SDK prompt-refinement implementation, shared by the agent tool and new typed IPC composer action. The independently written template preserves language, exact technical identifiers, explicit constraints and negations, asks for useful acceptance criteria, distinguishes assumptions, and forbids invented requirements or widened permissions. Version 1.1.0 does not claim guaranteed model compliance or a numerical quality multiplier. There is no objective universal "best" optimizer established by this review.

## Verification and limits

Final Agent2 regression: **676 tests passed across 43 targeted files**. Focused prompt-improver typecheck and browser interaction smoke passed. These are scoped results, not whole-app certification.

- Component tests cover consent, editable review/apply, empty/oversized drafts, stale edits, cancellation/late results, chat switch, unmount, duplicate requests, streaming disable and retry after errors.
- IPC handler tests cover selected settings/chat routing, bounded contracts, request/window-scoped cancellation, duplicate exclusion, window destruction and failure cleanup. Contract-derived preload channels expose the new methods without broadening the IPC allowlist.
- Focused typecheck: `npx tsgo -p scripts/qa/tsconfig.prompt-improver.json` includes UI/contracts and the new handler/service graph and tests.
- Browser smoke: `scripts/qa/browser-prompt-improver-smoke.mjs` checks real placement beside the microphone, disclosure/review dialog, mobile width, read-only backend rejection and original preservation. Existing four-route browser smoke also passes.
- The browser development preview intentionally cannot run provider inference. The successful proposal/apply flow is tested with mocks; live credentialed Electron generation and comparative generated-prompt quality have not been measured. The full application typecheck exceeded this sandbox's memory/time budget and was explicitly stopped; it is not claimed as a pass.

No merge was performed as part of this interrupted-and-redirected task.
