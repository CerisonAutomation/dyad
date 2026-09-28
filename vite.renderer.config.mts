import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ReactCompilerConfig = {};

// The React Compiler is a whole extra compilation pass over every component
// and dominates renderer build time. It only produces runtime memoisation, so
// local rebuilds can opt out of it.
const useReactCompiler = process.env.DYAD_REACT_COMPILER !== "false";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: useReactCompiler
        ? {
            plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
          }
        : undefined,
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
