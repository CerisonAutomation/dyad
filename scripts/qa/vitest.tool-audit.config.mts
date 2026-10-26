import { defineConfig } from "vitest/config";
import base from "../../vitest.config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    name: "tool-policy-unit",
    environment: "happy-dom",
    maxWorkers: 1,
    setupFiles: [
      fileURLToPath(new URL("./tool-audit.setup.ts", import.meta.url)),
    ],
  },
});
