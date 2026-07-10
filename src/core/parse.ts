/**
 * Markdown → HTML.
 *
 * `marked` in GFM mode does the parsing; `sanitizeHtml` locks the output down
 * to the editor's tag/attribute allow-list. Task lists are decorated with the
 * conventional `contains-task-list` / `task-list-item` classes so CSS can style
 * them and the editor can find the checkboxes.
 *
 * Instancing: each parser owns a `new Marked()` — never the global `marked`
 * singleton, whose options/extensions would leak into every other consumer of
 * marked on the page. `createMarkdownParser` accepts plugin extensions;
 * `parseMarkdown` stays bound to a default instance.
 */

import { Marked, type MarkedExtension } from "marked";
import { sanitizeHtml, type SanitizeOptions } from "./sanitize.js";

export interface ParseOptions {
  /**
   * Run the output through the built-in sanitiser (requires a DOM — always
   * available in browsers and in jsdom/happy-dom tests). Set `false` for a
   * DOM-free, trusted-input SSR path that returns raw `marked` HTML.
   * Default: true.
   */
  sanitize?: boolean;
  /**
   * Make task-list checkboxes interactive (editor classes + enabled inputs).
   * Set `false` for export paths (e.g. the clipboard's HTML flavor) where
   * GFM's native disabled checkboxes are the right semantics. Default: true.
   */
  decorateTasks?: boolean;
}

export function createMarkdownParser(
  extensions: MarkedExtension[] = [],
  sanitizeOptions?: SanitizeOptions,
): (md: string, opts?: ParseOptions) => string {
  const marked = new Marked({ gfm: true, breaks: false });
  for (const ext of extensions) marked.use(ext);
  return (md: string, opts: ParseOptions = {}) => {
    const raw = String(marked.parse(md ?? "", { async: false }));
    if (opts.sanitize === false || typeof DOMParser === "undefined") return raw;
    const clean = sanitizeHtml(raw, sanitizeOptions);
    return opts.decorateTasks === false ? clean : decorateTaskLists(clean);
  };
}

const defaultParse = (() => {
  let fn: ((md: string, opts?: ParseOptions) => string) | null = null;
  return (md: string, opts?: ParseOptions) => (fn ??= createMarkdownParser())(md, opts);
})();

/** Convert a Markdown string to HTML (default parser, no extensions). */
export function parseMarkdown(md: string, opts: ParseOptions = {}): string {
  return defaultParse(md, opts);
}

/**
 * Add `contains-task-list` / `task-list-item` classes to GFM task lists so
 * they can be styled and located. DOM-based; call only where a DOM exists.
 */
export function decorateTaskLists(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return html;
  root.querySelectorAll('li > input[type="checkbox"], li > p > input[type="checkbox"]').forEach((input) => {
    const li = input.closest("li");
    if (!li) return;
    // GFM renders task checkboxes `disabled`; the editor makes them interactive.
    input.removeAttribute("disabled");
    li.classList.add("task-list-item");
    li.setAttribute("data-task", input.hasAttribute("checked") ? "done" : "todo");
    const list = li.parentElement;
    if (list && (list.tagName === "UL" || list.tagName === "OL")) {
      list.classList.add("contains-task-list");
    }
  });
  return root.innerHTML;
}
