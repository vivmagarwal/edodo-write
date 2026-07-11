/**
 * Details / toggle — a collapsible `<details>`/`<summary>` block.
 *
 *   stored:   <details data-md-open><summary>**S**</summary>body</details>
 *   parse:    <details open><summary><strong>S</strong></summary><p>body</p></details>
 *   serialize: back to the stored HTML form, byte-stable.
 *
 * The stored form is raw HTML embedded in the Markdown — a deliberate, narrow
 * exception to the "no HTML in storage" rule (it SUPERSEDES the v0.5 "toggles
 * rejected" stance) because a collapsible toggle has no native Markdown form
 * and markdown-composer parity requires it. GitHub renders `<details>`
 * natively, so it degrades to an expandable block everywhere.
 *
 * Round-trip markers live on the `<details>` element:
 *   • data-md-open   → the toggle is expanded (rendered as the native `open`).
 *   • data-md-empty  → the summary has no content.
 *   • data-md-block  → an opaque marker the host may set; preserved verbatim.
 *
 * The summary renders INLINE Markdown (`**S**` → bold); the body renders as
 * block Markdown. Both halves are re-serialized on the way out so the toggle
 * round-trips even after the reader rendered it.
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";

declare module "../core/types.js" {
  interface CommandPayloads {
    /** Insert an empty collapsible toggle at the caret. */
    insertDetailsBlock: void;
  }
}

// `<details ATTRS><summary>SUMMARY</summary>BODY</details>` at a line start.
// ATTRS/SUMMARY/BODY are lazy so nested `<` in the body can't over-consume the
// closing tag (the first `</details>` wins).
const DETAILS_RE =
  /^<details([^>]*)>[ \t]*\n?[ \t]*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>[ \t]*(?=\n|$)/;

/** Presence of a boolean-ish attribute (`open`, `data-md-open`, …) in a raw attr string. */
function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?=[\\s=>]|$)`, "i").test(attrs);
}

export function detailsToggle(): EdodoPlugin {
  return definePlugin({
    name: "details",

    commands: {
      insertDetailsBlock: {
        run: (ctx: EditorContext) => {
          // Reuse the plugin's own parse so the inserted block is a real,
          // rendered <details> (one undo step via markdown.insert's transact).
          ctx.markdown.insert(
            "<details data-md-open><summary>Toggle</summary>\n\nDetails\n\n</details>",
          );
        },
      },
    },

    slashItems: [{
      id: "details",
      title: "Toggle",
      hint: "Collapsible details block",
      keywords: ["toggle", "details", "collapse", "collapsible", "expand", "accordion"],
      group: "Media",
      command: "insertDetailsBlock",
    }],

    // <details>/<summary> are not in the core floor; `open` is not a global
    // attr. Widen for them (data-md-* markers ride on class/id-adjacent slots).
    sanitize: {
      tags: ["details", "summary"],
      attributes: {
        details: ["open", "data-md-open", "data-md-empty", "data-md-block"],
      },
    },

    markdown: {
      marked: [{
        extensions: [{
          name: "details",
          level: "block",
          start(src: string) {
            const m = /(?:^|\n)<details[\s>]/.exec(src);
            if (!m) return undefined;
            return m[0].startsWith("\n") ? m.index + 1 : m.index;
          },
          tokenizer(src: string) {
            const m = DETAILS_RE.exec(src);
            if (!m) return undefined;
            const attrs = m[1];
            const summaryRaw = m[2].trim();
            const bodyRaw = m[3].trim();
            return {
              type: "details",
              raw: m[0],
              open: hasAttr(attrs, "open") || hasAttr(attrs, "data-md-open"),
              hasBlock: hasAttr(attrs, "data-md-block"),
              summaryTokens: this.lexer.inlineTokens(summaryRaw),
              bodyTokens: this.lexer.blockTokens(bodyRaw),
            };
          },
          renderer(token) {
            const summary = this.parser.parseInline(token.summaryTokens ?? []);
            const body = this.parser.parse(token.bodyTokens ?? []);
            const attrs =
              (token.open ? " open" : "") + (token.hasBlock ? " data-md-block" : "");
            return `<details${attrs}><summary>${summary}</summary>${body}</details>\n`;
          },
        }],
      }],
      turndown: (td) => {
        td.addRule("details", {
          filter: (node) => node.nodeName === "DETAILS",
          replacement: (_content, node) => {
            const el = node as HTMLElement;
            const summaryEl = el.querySelector("summary");
            const open = el.hasAttribute("open") || el.hasAttribute("data-md-open");
            const hasBlock = el.hasAttribute("data-md-block");
            // Serialize the two halves independently so the stored form keeps
            // its `<summary>…</summary>body` shape (the whole-element `content`
            // would fuse them). Nested turndown is safe — a fresh parse tree.
            const summaryMd = (summaryEl ? td.turndown(summaryEl.innerHTML) : "")
              .replace(/\s+/g, " ")
              .trim();
            const clone = el.cloneNode(true) as HTMLElement;
            clone.querySelector("summary")?.remove();
            const bodyMd = td.turndown(clone.innerHTML).trim();
            const empty = summaryMd === "";
            let attrs = "";
            if (hasBlock) attrs += " data-md-block";
            if (open) attrs += " data-md-open";
            if (empty) attrs += " data-md-empty";
            return `\n\n<details${attrs}><summary>${summaryMd}</summary>${bodyMd}</details>\n\n`;
          },
        });
      },
    },
  });
}
