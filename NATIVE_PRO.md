# NATIVE PRO — Fork Conversion Map

Converts ALL Agent v2 (local agent) tools in this fork to run on normal
agents with BYO provider keys: no Dyad subscription, zero engine calls.
Internal use only (see License).

## License — read first

`src/pro/` ships under **FSL-1.1-ALv2** (Functional Source License). Internal
use and access is a Permitted Purpose. A Competing Use (making this available
to others as a commercial product that substitutes for Dyad) is NOT permitted.
Keep this fork private. The rest of the repo is Apache 2.0.

## Apply

```bash
npm install          # repo ships package-lock.json
node scripts/enable-native-pro.mjs
npm run dev           # or the build/dev scripts in package.json
```

Then in app Settings, configure provider API keys. Do NOT add an "auto"
provider key — that is the engine credential and the only thing that routes
traffic to Dyad's cloud. Without it, zero engine calls occur.

Note: the `explore_code` subagent hardcodes a small OpenAI model
(`SUBAGENT_MODEL`), so keep an OpenAI key (or compatible) configured.

## Agent v2 tools that now run on normal agents (BYO keys)

| Tool / feature                                     | Previously gated by                     | Now              |
| -------------------------------------------------- | --------------------------------------- | ---------------- |
| Local Agent chat mode (default)                    | `isDyadProEnabled`                      | always available |
| Subagent teams + implementer subagent              | `assertPro` → `isDyadProEnabled`        | passes           |
| `explore_code` subagent                            | `assertDyadValueAvailable` (engine key) | any provider key |
| `grep` / `list_files` / `read_file` agent tools    | tool catalog filter                     | all exposed      |
| Pro lazy edits (v1/v2), smart file context         | settings flags                          | honored          |
| Auto-review, review button, fix-pre-commit-with-AI | Pro preconditions                       | pass             |
| Basic Agent quota                                  | `isBasicAgentMode`                      | bypassed         |
| Model picker locks / free Pro model states         | UI gate                                 | unlocked         |
| Chat titles + summaries (auxiliary)                | engine remap                            | BYO providers    |

Every subagent model call goes through `getModelClient`, which routes to
your own providers whenever no `auto` engine key is configured.

## Cloud features that need a local replacement (not gate-flippable)

1. **Voice-to-text** — `transcribeWithDyadEngine` (`src/ipc/handlers/pro_handlers.ts`)
   calls the engine. Local replacement: whisper.cpp / faster-whisper behind the
   same `transcribeAudio` IPC handler.
2. **Cloud sandboxes** — `cloudSandboxFetch` (`src/ipc/utils/cloud_sandbox_provider.ts`).
   Local replacement already in settings: `runtimeMode2: "docker"` runs apps
   in a local container. Use Docker mode instead of cloud.
3. **Pro gateway / auto models** — `createDyadEngine` in `get_model_client.ts`.
   Unreachable without an auto key — use BYO providers.
4. **Web search tool** — verify after build whether it executes engine-side;
   if so, point it at a SearXNG or Brave Search API instance locally.

## Verification checklist (run after applying)

- `node scripts/enable-native-pro.mjs` exits 0 on fresh clone (4 patches).
- Re-run exits 0 as no-op ("already patched").
- App boots; default chat mode is Agent; Subagent settings panel visible.
- Run a build chat with a BYO key; confirm titles/summaries generate.
- Trigger `explore_code` (ask agent to locate code) with an OpenAI key set.
- Confirm zero outbound requests to the Dyad engine host (network tab or
  firewall log) with no auto key configured.

## Capability extraction roadmap (bolt.diy + Creable)

| Source                                    | Capability                                        | Port target                           |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| bolt.diy                                  | WebContainer in-browser runtime (zero local Node) | preview system (`src/preview_iframe`) |
| bolt.diy                                  | 22+ LLM provider adapters incl. LM Studio/Ollama  | `src/chat_stream` provider layer      |
| bolt.diy                                  | Docker/Electron one-command self-host             | packaging (`forge.config.ts`)         |
| Creable (totalumlabs/ai-app-builder-open) | Multi-tenant hosting + custom domains             | publish panel (Coolify hook)          |
| Creable                                   | Bidirectional GitHub sync per project             | `src/github_ops`                      |
| Creable                                   | Visual/no-code editor overlay                     | renderer UI layer                     |

## Upstream sync

`scripts/enable-native-pro.mjs` is drift-detected: if upstream changes a
patched function, it fails naming the exact file that moved. Re-apply after
every upstream merge.
