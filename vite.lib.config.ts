import { defineConfig } from "vite";
import { isAbsolute } from "node:path";
import { fileURLToPath, URL } from "node:url";

/**
 * Library build. Bundles our own code into two ESM entries and externalises
 * every dependency (marked, turndown, react) so consumers resolve them via
 * their own package manager. `.d.ts` types are emitted separately by
 * `tsc -p tsconfig.lib.json`. The single stylesheet is emitted as
 * `dist-lib/edodo-write.css`. Output → dist-lib/.
 */
export default defineConfig({
  // Don't copy the site's public/ (llms.txt etc.) into the published package.
  publicDir: false,
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: {
        index: fileURLToPath(new URL("./src/lib/index.ts", import.meta.url)),
        react: fileURLToPath(new URL("./src/lib/react.tsx", import.meta.url)),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // Externalise all bare (node_modules) imports; bundle only our own code.
      external: (id) => !id.startsWith(".") && !isAbsolute(id),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith(".css"))
            ? "edodo-write.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
