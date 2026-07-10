/**
 * Markdown → HTML.
 *
 * `marked` in GFM mode does the parsing; `sanitizeHtml` locks the output down
 * to the editor's tag/attribute allow-list. Task lists are decorated with the
 * conventional `contains-task-list` / `task-list-item` classes so CSS can style
 * them and the editor can find the checkboxes.
 */

import { marked } from "marked";
import { sanitizeHtml } from "./sanitize.js";

marked.setOptions({ gfm: true, breaks: false });

export interface ParseOptions {
  /**
   * Run the output through the built-in sanitiser (requires a DOM — always
   * available in browsers and in jsdom/happy-dom tests). Set `false` for a
   * DOM-free, trusted-input SSR path that returns raw `marked` HTML.
   * Default: true.
   */
  sanitize?: boolean;
}

/** Convert a Markdown string to HTML. */
export function parseMarkdown(md: string, opts: ParseOptions = {}): string {
  const raw = String(marked.parse(md ?? "", { async: false }));
  if (opts.sanitize === false || typeof DOMParser === "undefined") return raw;
  return decorateTaskLists(sanitizeHtml(raw));
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
