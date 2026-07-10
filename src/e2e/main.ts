/**
 * E2E fixture page (served by Vite at /e2e.html, dev-only — the site build
 * only includes index.html). Mounts a bare EdodoWrite and exposes it on
 * `window` so Playwright specs can read `getMarkdown()` / call the API
 * directly. Keep this page free of React and of any site chrome.
 *
 * Query params:
 *   ?value=…            initial Markdown
 *   ?plugins=a,b        register first-party plugins (highlight, callout)
 *   ?exclude=a,b        core-preset feature keys to remove
 *   ?upload=mock|fail   image uploader stub (mock: resolves a CDN-ish URL
 *                       after 150 ms; fail: rejects). Omitted: data-URL fallback.
 */
import "../styles.css";
import { EdodoWrite, type EdodoPlugin, type ImageUploader } from "../lib/index.js";
import { highlight, callout, math, diagrams, edodoDraw, tags, embeds } from "../plugins/index.js";

declare global {
  interface Window {
    editor: EdodoWrite;
    EdodoWrite: typeof EdodoWrite;
  }
}

const AVAILABLE: Record<string, () => EdodoPlugin> = {
  highlight,
  callout,
  math: () => math(),
  // Deterministic fake renderer for E2E assertions (no engine dependency).
  diagrams: () =>
    diagrams({
      renderers: {
        fake: (source, el) => {
          const pre = document.createElement("div");
          pre.className = "fake-diagram";
          pre.textContent = `rendered:${source.trim()}`;
          el.appendChild(pre);
        },
      },
    }),
  // The real engine (edododraw is a devDependency of this repo).
  edododraw: () => edodoDraw(),
  tags: () =>
    tags({
      source: (query: string) => {
        const all = [
          { label: "alpha", href: "https://example.com/tags/alpha" },
          { label: "beta", href: "https://example.com/tags/beta" },
          { label: "gamma" },
        ];
        return all.filter((t) => t.label.startsWith(query.toLowerCase()));
      },
    }),
  embeds: () => embeds(),
};

const params = new URLSearchParams(location.search);
const plugins = (params.get("plugins") ?? "")
  .split(",")
  .filter(Boolean)
  .map((name) => {
    const factory = AVAILABLE[name];
    if (!factory) throw new Error(`unknown fixture plugin "${name}"`);
    return factory();
  });
const exclude = (params.get("exclude") ?? "").split(",").filter(Boolean);

let uploadImage: ImageUploader | undefined;
const uploadMode = params.get("upload");
if (uploadMode === "mock") {
  uploadImage = async (file) => {
    await new Promise((r) => setTimeout(r, 150));
    return `https://cdn.example.com/mock/${encodeURIComponent(file.name)}`;
  };
} else if (uploadMode === "fail") {
  uploadImage = async () => {
    await new Promise((r) => setTimeout(r, 50));
    throw new Error("mock upload failure");
  };
}

const host = document.getElementById("host")!;
window.EdodoWrite = EdodoWrite;
window.editor = new EdodoWrite(host, {
  value: params.get("value") ?? "",
  autofocus: true,
  plugins,
  exclude: exclude.length ? exclude : undefined,
  uploadImage,
});
