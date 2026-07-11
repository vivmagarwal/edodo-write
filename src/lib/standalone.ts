/**
 * `edodo-write/standalone` — the CDN / no-build-step entry.
 *
 * One self-contained ESM file: the core editor + every first-party plugin,
 * with `marked`/`turndown` inlined so a static HTML page needs no bundler
 * and no import map:
 *
 *   <link rel="stylesheet" href="https://unpkg.com/edodo-write/dist-lib/edodo-write.css">
 *   <script type="module">
 *     import { EdodoWrite, highlight, callout } from
 *       "https://unpkg.com/edodo-write/dist-lib/standalone.js";
 *     const editor = new EdodoWrite(document.getElementById("app"), {
 *       value: "# Hello", plugins: [highlight(), callout()],
 *     });
 *   </script>
 *
 * Optional engines stay external: math() falls back to plain TeX unless
 * KaTeX is reachable, and edodoDraw() reports a readable error unless the
 * `edododraw` engine is reachable — provide either via an import map or use
 * https://esm.sh/edodo-write, which resolves everything automatically.
 */

export * from "./index.js";
export * from "../plugins/index.js";
