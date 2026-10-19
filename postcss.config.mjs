// Dyad styles with Tailwind v4 through the Vite plugin (@tailwindcss/vite),
// which does not need PostCSS.
//
// This file exists only to stop postcss-load-config from walking up the
// directory tree and picking up an unrelated project's PostCSS config. That
// matters here because this checkout lives under ~/Downloads, where a stray
// config from another project would otherwise be loaded and crash Vite with
// "Cannot find module '@tailwindcss/postcss'".
//
// The 1.10 tree has no postcss config at all and resolves nothing, because it
// is not nested under another project's directory.
export default { plugins: {} };
