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
import { parseDocument, DomUtils } from "htmlparser2";
import render from "dom-serializer";
import { isTag, type Element } from "domhandler";
import { sanitizeHtml, type SanitizeOptions } from "./sanitize.js";

export interface ParseOptions {
  /**
   * Run the output through the built-in sanitiser. The sanitiser is DOM-free,
   * so it runs everywhere (browsers, jsdom/happy-dom tests, and bare Node /
   * SSR). Set `false` for a trusted-input fast path that returns raw `marked`
   * HTML. Default: true.
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
    // The sanitiser is DOM-free — it ALWAYS runs (browser, jsdom, or bare
    // Node/SSR) unless the caller opts into the trusted-input fast path.
    if (opts.sanitize === false) return raw;
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

/** Add a class to an element's `class` attribute (deduped, like classList). */
function addClass(el: Element, cls: string): void {
  const classes = (el.attribs.class ?? "").split(/\s+/).filter(Boolean);
  if (!classes.includes(cls)) classes.push(cls);
  el.attribs.class = classes.join(" ");
}

/**
 * Add `contains-task-list` / `task-list-item` classes to GFM task lists so
 * they can be styled and located. DOM-free — safe in bare Node / SSR.
 */
export function decorateTaskLists(html: string): string {
  const doc = parseDocument(html ?? "", { decodeEntities: true });
  const inputs = DomUtils.findAll(
    (el) => el.name === "input" && el.attribs.type === "checkbox",
    doc.children,
  );
  for (const input of inputs) {
    // The checkbox must sit directly in an <li>, or in a <p> directly in an <li>.
    let li: Element | null = null;
    const parent = input.parent;
    if (parent && isTag(parent)) {
      if (parent.name === "li") li = parent;
      else if (parent.name === "p" && parent.parent && isTag(parent.parent) && parent.parent.name === "li") {
        li = parent.parent;
      }
    }
    if (!li) continue;
    // GFM renders task checkboxes `disabled`; the editor makes them interactive.
    delete input.attribs.disabled;
    addClass(li, "task-list-item");
    li.attribs["data-task"] = "checked" in input.attribs ? "done" : "todo";
    const list = li.parent;
    if (list && isTag(list) && (list.name === "ul" || list.name === "ol")) {
      addClass(list, "contains-task-list");
    }
  }
  return render(doc.children, { encodeEntities: "utf8", emptyAttrs: true });
}
