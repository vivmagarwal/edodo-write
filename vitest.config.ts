import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      // Docs examples import the package by its public names — resolve them
      // to the source so `tests/docs-examples.test.ts` runs them verbatim.
      "edodo-write/react": fileURLToPath(new URL("./src/lib/react.tsx", import.meta.url)),
      "edodo-write/plugins": fileURLToPath(new URL("./src/plugins/index.ts", import.meta.url)),
      "edodo-write/testing": fileURLToPath(new URL("./src/lib/testing.ts", import.meta.url)),
      "edodo-write/parse": fileURLToPath(new URL("./src/lib/parse-api.ts", import.meta.url)),
      "edodo-write/email": fileURLToPath(new URL("./src/lib/email.ts", import.meta.url)),
      "edodo-write/ingest": fileURLToPath(new URL("./src/lib/ingest.ts", import.meta.url)),
      "edodo-write/styles.css": fileURLToPath(new URL("./src/styles.css", import.meta.url)),
      "edodo-write": fileURLToPath(new URL("./src/lib/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
