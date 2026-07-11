/**
 * Footnotes — GitHub-flavoured `[^id]` references + `[^id]: text` definitions.
 *
 *   stored:    see[^1]
 *
 *              [^1]: note
 *   parse ref: see<sup class="ew-fn-ref"><a href="#fn-1" id="fnref-1">1</a></sup>
 *   parse defs: a trailing <section class="ew-footnotes"><ol>…</ol></section>
 *   serialize:  back to `[^id]` / `[^id]: text`, byte-stable.
 *
 * Numbering is by DEFINITION order (the first-defined footnote is [1]), not by
 * where the reference appears — matching GitHub. The stored `id` (which may be
 * any label, e.g. `[^note]`) is preserved on the chip so the round-trip writes
 * the original token back, never the display number.
 *
 * A reference with no matching definition is left LITERAL (`[^ghost]` survives
 * verbatim) — the tokenizer refuses to consume a ref it can't resolve.
 *
 * The definitions are collected into ONE trailing section regardless of where
 * they sit in the source; the per-parse state is reset by a marked preprocess
 * hook and the section emitted by a postprocess hook, so the codec stays
 * stateless between documents.
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { escapeAttr } from "./widget.js";

declare module "../core/types.js" {
  interface CommandPayloads {
    /** Insert a `[^n]` reference at the caret + a `[^n]:` definition stub. */
    insertFootnote: void;
  }
}

interface FootnoteDef {
  num: number;
  /** Rendered (inline) HTML of the definition body. */
  html: string;
  /** Whether a body has been assigned — the FIRST definition of an id wins. */
  filled: boolean;
}

// Definition: `[^id]: text` at a line start, with optional 4-space/tab
// continuation lines. id has no whitespace and no `]`.
const DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{4}|\t)[^\n]*)*)/;
// Reference: `[^id]` inline.
const REF_RE = /^\[\^([^\]\s]+)\]/;

export function footnote(): EdodoPlugin {
  // Per-parse state, reset by the preprocess hook so the codec is reusable.
  let defs = new Map<string, FootnoteDef>();
  let order: string[] = [];

  const reset = (): void => {
    defs = new Map();
    order = [];
  };

  const refHtml = (id: string, num: number): string =>
    `<sup class="ew-fn-ref"><a href="#fn-${escapeAttr(id)}" id="fnref-${escapeAttr(id)}">${num}</a></sup>`;

  const sectionHtml = (): string => {
    if (order.length === 0) return "";
    const items = order
      .map((id) => {
        const d = defs.get(id)!;
        return `<li id="fn-${escapeAttr(id)}" data-fn-id="${escapeAttr(id)}">${d.html}</li>`;
      })
      .join("");
    return `\n<section class="ew-footnotes"><ol>${items}</ol></section>\n`;
  };

  return definePlugin({
    name: "footnote",

    commands: {
      insertFootnote: {
        run: (ctx: EditorContext) => {
          const used = new Set<string>();
          ctx.root
            .querySelectorAll("sup.ew-fn-ref a[id], section.ew-footnotes li[data-fn-id]")
            .forEach((el) => {
              const raw = (el.getAttribute("id") ?? el.getAttribute("data-fn-id") ?? "")
                .replace(/^fn(?:ref)?-/, "");
              if (raw) used.add(raw);
            });
          let n = 1;
          while (used.has(String(n))) n += 1;
          const id = String(n);
          return ctx.transact(() => {
            const sup = document.createElement("sup");
            sup.className = "ew-fn-ref";
            const a = document.createElement("a");
            a.setAttribute("href", `#fn-${id}`);
            a.setAttribute("id", `fnref-${id}`);
            a.textContent = id;
            sup.appendChild(a);
            const sel = typeof window !== "undefined" ? window.getSelection() : null;
            const range =
              sel && sel.rangeCount && ctx.root.contains(sel.getRangeAt(0).startContainer)
                ? sel.getRangeAt(0)
                : null;
            if (range) {
              range.collapse(false);
              range.insertNode(sup);
              ctx.dom.placeCaretAfter(sup);
            }
            const p = document.createElement("p");
            p.textContent = `[^${id}]: `;
            ctx.root.appendChild(p);
            return true;
          });
        },
      },
    },

    slashItems: [{
      id: "footnote",
      title: "Footnote",
      hint: "Insert a [^n] reference + definition",
      keywords: ["footnote", "note", "citation", "reference"],
      group: "Advanced",
      command: "insertFootnote",
    }],

    // The trailing section + the ref chips need `section` and a per-item id.
    sanitize: {
      tags: ["section"],
      attributes: { li: ["data-fn-id"], a: ["id"] },
    },

    markdown: {
      marked: [{
        hooks: {
          preprocess(markdown: string): string {
            reset();
            return markdown;
          },
          postprocess(html: string): string {
            return html + sectionHtml();
          },
        },
        extensions: [
          {
            name: "footnoteDef",
            level: "block",
            start(src: string) {
              const m = /(?:^|\n)\[\^[^\]\s]+\]:/.exec(src);
              if (!m) return undefined;
              return m[0].startsWith("\n") ? m.index + 1 : m.index;
            },
            tokenizer(src: string) {
              const m = DEF_RE.exec(src);
              if (!m) return undefined;
              const id = m[1];
              if (!defs.has(id)) {
                order.push(id);
                defs.set(id, { num: order.length, html: "", filled: false });
              }
              // Collapse the 4-space/tab continuation indentation before the
              // body is inline-parsed.
              const body = m[2].replace(/\n(?:[ \t]{4}|\t)/g, "\n");
              return {
                type: "footnoteDef",
                raw: m[0],
                fnId: id,
                tokens: this.lexer.inlineTokens(body),
              };
            },
            renderer(token) {
              // The body is rendered here (during the render pass) and stashed;
              // the trailing section is assembled in the postprocess hook. When
              // an id is defined twice, the FIRST body wins (GitHub behaviour) —
              // a later duplicate definition never overwrites it.
              const id = String(token.fnId);
              const def = defs.get(id);
              if (def && !def.filled) {
                def.html = this.parser.parseInline(token.tokens ?? []);
                def.filled = true;
              }
              return "";
            },
          },
          {
            name: "footnoteRef",
            level: "inline",
            start: (src: string) => src.indexOf("[^"),
            tokenizer(src: string) {
              const m = REF_RE.exec(src);
              if (!m) return undefined;
              const def = defs.get(m[1]);
              if (!def) return undefined; // unmatched → leave literal
              return { type: "footnoteRef", raw: m[0], fnId: m[1], num: def.num };
            },
            renderer(token) {
              return refHtml(String(token.fnId), Number(token.num));
            },
          },
        ],
      }],
      turndown: (td) => {
        td.addRule("footnoteRef", {
          filter: (node) =>
            node.nodeName === "SUP" && (node as HTMLElement).classList.contains("ew-fn-ref"),
          replacement: (_content, node) => {
            const el = node as HTMLElement;
            const a = el.querySelector("a");
            const id =
              a?.getAttribute("id")?.replace(/^fnref-/, "") ??
              a?.getAttribute("href")?.replace(/^#fn-/, "") ??
              "";
            return `[^${id}]`;
          },
        });
        td.addRule("footnoteSection", {
          filter: (node) =>
            node.nodeName === "SECTION" &&
            (node as HTMLElement).classList.contains("ew-footnotes"),
          replacement: (_content, node) => {
            const items = Array.from((node as HTMLElement).querySelectorAll("li")).map((li) => {
              const id =
                li.getAttribute("data-fn-id") ??
                (li.getAttribute("id") ?? "").replace(/^fn-/, "");
              const text = td.turndown(li.innerHTML).replace(/\n+/g, " ").trim();
              return `[^${id}]: ${text}`;
            });
            return "\n\n" + items.join("\n\n") + "\n\n";
          },
        });
      },
    },
  });
}
