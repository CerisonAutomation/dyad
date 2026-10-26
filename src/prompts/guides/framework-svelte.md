# Svelte and SvelteKit application engineering

Inspect package.json, lockfile, svelte.config.*, vite.config.*, routing and the installed Svelte/SvelteKit major versions. Svelte is the component framework; SvelteKit adds application routing/server conventions. Do not treat a Vite Svelte project as SvelteKit or migrate an existing React application without a migration requirement.

- For Svelte 5 runes code, understand $state, $derived and $props; reserve $effect for actual side effects rather than derived-state synchronization. Preserve valid legacy components when not migrating them. Do not blindly mix new Component(...) legacy APIs with mount/unmount APIs.
- Follow existing keyed list identity, event/callback conventions and component boundaries. Clean up subscriptions, timers and listeners; guard stale async results. Keep keyboard navigation, focus, labels and reduced-motion behavior working.
- In SvelteKit, distinguish universal load from server load, endpoints and form actions. Keep credentials and private environment variables server-side. Avoid request-specific state in module-level shared stores. Do not access window/document during SSR; use lifecycle/client boundaries where required. Test direct navigation and hydration, not only client transitions.
- Validate form input and authorization on the server; pending/error states and progressive enhancement should not bypass authorization. Choose deployment adapters for the actual target; a static adapter is not a server backend.
- Run the project's existing check script/svelte-check and focused component tests where available. Use browser checks for SSR/hydration, forms and navigation; report absent tooling rather than installing or claiming it ran automatically.

Context7 references tested on 2026-10-26:
- https://context7.com/sveltejs/svelte/llms.txt?tokens=1500
- https://context7.com/sveltejs/kit/llms.txt?tokens=1500

Samples include legacy component APIs and repository-contributor setup commands. Select relevant sections and verify against https://svelte.dev/docs and the installed versions before changing application code.
