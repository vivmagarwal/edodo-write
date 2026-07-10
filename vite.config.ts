import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Playground / docs-site build (→ dist/). Relative `base` so the built SPA
 * works on GitHub Pages under /edodo-write/ (and anywhere else).
 */
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
    },
  },
  server: {
    port: 5283,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
}));
