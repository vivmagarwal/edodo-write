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
 */
import "../styles.css";
import { EdodoWrite, type EdodoPlugin } from "../lib/index.js";
import { highlight, callout } from "../plugins/index.js";

declare global {
  interface Window {
    editor: EdodoWrite;
    EdodoWrite: typeof EdodoWrite;
  }
}

const AVAILABLE: Record<string, () => EdodoPlugin> = { highlight, callout };

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

const host = document.getElementById("host")!;
window.EdodoWrite = EdodoWrite;
window.editor = new EdodoWrite(host, {
  value: params.get("value") ?? "",
  autofocus: true,
  plugins,
  exclude: exclude.length ? exclude : undefined,
});
