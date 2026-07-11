import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/**
 * The self-contained CDN bundle (`dist-lib/standalone.js`): core + first-party
 * plugins with `marked`/`turndown`/gfm INLINED — a static HTML page imports
 * one file with no import map. React and the optional heavy engines
 * (edododraw, katex) remain external: the React wrapper is pointless without
 * a bundler, and the engines lazy-load with graceful fallbacks.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist-lib",
    emptyOutDir: false, // build:lib already populated dist-lib
    sourcemap: true,
    target: "es2022",
    minify: true,
    lib: {
      entry: fileURLToPath(new URL("./src/lib/standalone.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "standalone.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "edododraw", "katex"],
      output: { inlineDynamicImports: true },
    },
  },
});
