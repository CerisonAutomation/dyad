# Image generation: provider setup and source boundaries

## GPT: ChatGPT/Codex subscription OAuth, NOT API billing

In **Settings → Model Providers → Image generation**, choose **ChatGPT / Codex subscription — OAuth, no API key**. Enter an image-capable model available to your account. Use **Connect/reconnect ChatGPT (OAuth)** if necessary, then save.

- Reuses the existing encrypted Codex OAuth connection and refresh flow, not provider API keys or `OPENAI_API_KEY`.
- Sends only to the fixed `https://chatgpt.com/backend-api/codex/responses` subscription endpoint. Configurable API URLs/keys are ignored for this backend; redirects are forbidden.
- Saving selects `proModelUsage: subscription` for chat. That chat mode fails closed on unavailable authentication/catalog/models rather than switching to API billing. Existing explicit BYOK modes for other providers remain separate.
- Direct OpenAI image API endpoints and GPT-image IDs in the API-compatible backend are rejected. No automatic API or alternate-provider fallback, including on 401/403/429/5xx, expired credentials, unavailable tools, truncated streams or text-only answers.
- Images consume subscription usage limits. This does not promise unlimited quota or override account-side credit/plan policies.
- The Codex native image-tool transport is **experimental**, not a documented stable public Images API. No live authenticated image generation was performed here. Unsupported accounts/models fail explicitly.

Official documentation describes native image generation and its Codex usage limits: https://developers.openai.com/codex/image-generation (currently redirects to ChatGPT Learn). Authentication/source distinction: https://developers.openai.com/codex/auth . Third-party protocol implementation reviewed as research, not installed or executed: https://github.com/zerodow/codex-imagegen .

## Hosted free-allocation alternative

Cloudflare Workers AI documents **10,000 free neurons/day**. Workers Free hard-limits after the allocation; Workers Paid may charge overage. The app does not verify account plan or enforce a provider-side spending cap. Use a Workers Free account if you require hard quota errors instead of overage charges.

| Example model (editable, not runtime-pinned) | Input format | Why consider it |
| --- | --- | --- |
| `@cf/black-forest-labs/flux-1-schnell` | JSON | Low-usage practical starting option |
| `@cf/black-forest-labs/flux-2-klein-4b` | Multipart | Newer option with configurable output dimensions |

Enter your account ID and a Workers AI token in the image-specific credential slot. Tokens use existing provider-secret encryption. No token belongs in the model/prompt/endpoint fields. Saving settings sends no image request. Different Cloudflare models may require different protocols; choose the documented format. Not every model is available to every plan.

No comparative quality benchmark was performed, so neither is claimed to be objectively “best.” Official references checked during this work:

- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
- https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/
- https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/

## Other providers and local servers

An explicitly configured, image-capable OpenAI-compatible `/images/generations` server is also supported. A chat-only server, standard ComfyUI, or an arbitrary Stable Diffusion server is not automatically API-compatible. Server installation/model downloads/GPU provisioning are not supplied by this adapter. Plain HTTP is accepted only for explicitly selected loopback hosts; remote services require HTTPS and explicit billing authorization. This backend is not the GPT API route.

## Safety and verification

Both the agent tool and standalone media generator use the same main-side transport. Requests and bodies have cancellation/time bounds. Response bodies, base64 payloads, raster signatures and dimensions are bounded/checked. PNG/JPEG/WebP retain their actual extensions; this is metadata/signature validation, not a full pixel decoder. Response-provided download URLs must stay on the configured origin and cannot redirect or receive the API authorization header. External-CDN-only URL responses are intentionally unsupported: use base64. Managed image directories reject existing symlinks; this is not an OS sandbox against hostile concurrent filesystem processes.

The service retains recording/deletion fences, app/media/repository coordination, atomic saves and cancellation cleanup. Filenames now have random uniqueness. The tool also saves atomically and asks consent by default.

Latest focused audit: **73 files, 1,121 passed, 2 Windows-only skips on Linux**. Includes OAuth routing/no-API-fallback fixtures, a real loopback HTTP protocol fixture, real Chromium-generated tiny JPEG/WebP fixtures, service lifecycle tests, and tool save/symlink tests. Bounded types and actual browser renderer checks passed. These are not live Cloudflare/OpenAI account tests or an Electron native runtime certification.
