# OpenCode Go request headers

Checked 2026-10-26 against the official documentation:

- https://opencode.ai/docs/go/ (redirects to https://opencode.ai/v2/docs/console/go/), “Where can I use it?”: identify the coding agent with its own User-Agent and send a stable `x-opencode-session` per conversation for routing/prompt caching.
- https://github.com/deepseek-ai/deepseek-harness/discussions/5495: provider request for conversation-stable IDs, including auxiliary calls. A single constant for all chats or a fresh random ID per HTTP request is not the correct conversation identity.

## Implementation

Custom OpenAI-compatible providers using the exact HTTPS `opencode.ai/zen/go/v1` or `opencode.ai/zen/v1` base URL now receive:

- `x-opencode-session`: deterministic UUIDv5 derived from an installation namespace and conversation ID, stable across turns, retries, client recreation and compaction. Distinct chats/installations have distinct IDs. The raw installation/telemetry ID is not transmitted.
- `x-opencode-client: agent2`.
- `User-Agent: Agent2`, followed by the SDK's own identification if present. No impersonation of OpenCode's CLI or other validated clients.

Enforcement happens at the final fetch boundary: setting a provider header alone was insufficient because AI SDK call headers replaced the configured User-Agent. Existing authorization/body/abort options remain intact. No provider/model selection is hardcoded; URL matching adds only the required transport metadata to dynamically configured providers. Other origins, HTTP, credential URLs, nonstandard ports and unrelated paths do not receive these headers. Final fetch destinations are also validated, and automatic HTTP redirects are rejected to prevent forwarding credentials or routing identity. Proxies/custom domains are not automatically identified as OpenCode.

The existing main chat context is used directly. Chat IDs are now also threaded through code/history explorers, subagent execution, compaction, prompt improvement, and shell/MCP safety review. Help conversations use their stable help-session ID. Detached operations without a conversation use a new UUID per model client, retained for that client's retries/steps; separate operations do not share a global fallback ID. Unknown namespaces likewise fall back to a per-client UUID rather than sharing an identity across installations.

## Verification

- `opencode_headers.test.ts`: stable/different conversation and installation IDs, UUID format, official URLs, adversarial/unrelated URL rejection, detached and named sessions.
- `get_model_client.test.ts`: captures requests from real AI SDK provider transports for streaming and non-streaming generation; verifies session stability/separation, own User-Agent, client header, preserved Bearer authentication and absence of OpenCode session headers on unrelated providers.
- Auxiliary caller tests assert that prompt improvement, safety review and help pass conversation context rather than losing it during model creation.
- `npm run qa:agent2` includes the new header suite; focused type checking and presubmit are also run.

No authenticated production OpenCode request was made, and this is not a claim of provider-side validation or account eligibility. No API keys were added to the repository or requested in chat.

Final results: **749 tests / 50 suites passed**, focused types passed, presubmit passed with 0 errors and 5 warnings. Logs: `/home/user/opencode-regression-final.log`, `/home/user/opencode-types.log`, `/home/user/opencode-presubmit.log`. One earlier concurrent QA run hit an unrelated ModelPicker five-second timeout under load; the complete isolated rerun passed without changing that test's timeout.
