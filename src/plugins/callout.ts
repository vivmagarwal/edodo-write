/**
 * Callout — Notion-style callout blocks stored as GitHub alert syntax:
 *
 *   > [!NOTE]
 *   > Useful information users should know.
 *
 * Why this syntax: it is plain Markdown (round-trips everywhere), GitHub
 * renders it natively, it degrades to an ordinary blockquote in any other
 * viewer, and it stays legible to LLMs — exactly the storage contract this
 * editor exists for. (Notion's own callouts have no Markdown form; this is
 * the deliberate mapping. Toggles are rejected for the same reason.)
 *
 * In the editor a callout is `<blockquote data-callout="note">…</blockquote>`,
 * styled with a colored border + label. Type `[!note] ` at the start of a
 * quote, or use the slash items.
 */

import { definePlugin, type EdodoPlugin } from "../lib/index.js";

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

declare module "../core/types.js" {
  interface CommandPayloads {
    callout: { kind?: CalloutKind };
  }
}

const KIND_RE = new RegExp(`^\\[!(${CALLOUT_KINDS.join("|")})\\] $`, "i");

export function callout(): EdodoPlugin {
  return definePlugin({
    name: "callout",

    commands: {
      callout: {
        run: (ctx, payload?: { kind?: CalloutKind }) => {
          const block = ctx.dom.currentBlock();
          if (!block) return false;
          const kind = payload?.kind ?? "note";
          if (block.tagName === "BLOCKQUOTE") {
            block.setAttribute("data-callout", kind);
            return;
          }
          const bq = document.createElement("blockquote");
          bq.setAttribute("data-callout", kind);
          while (block.firstChild) bq.appendChild(block.firstChild);
          ctx.dom.ensureNotEmpty(bq);
          block.replaceWith(bq);
          ctx.dom.placeCaretAtEnd(bq);
        },
        isActive: (ctx) => !!ctx.dom.currentBlock()?.hasAttribute("data-callout"),
      },
    },

    inputRules: [
      {
        // `> ` already became a blockquote (core rule); typing `[!note] `
        // inside one upgrades it. `within` scopes the rule to blockquotes.
        kind: "block",
        within: ["BLOCKQUOTE"],
        trigger: KIND_RE,
        apply: (ctx, match, block) => {
          block.setAttribute("data-callout", match[1].toLowerCase());
          ctx.dom.deleteLeadingChars(block, match[0].length);
          return true;
        },
      },
    ],

    slashItems: [
      { id: "callout-note", title: "Callout", hint: "Highlighted note (> [!NOTE])", keywords: ["callout", "note", "aside", "info"], group: "Media", command: "callout", payload: { kind: "note" } },
      { id: "callout-warning", title: "Warning callout", hint: "Attention-grabbing warning", keywords: ["callout", "warning", "caution", "alert"], group: "Media", command: "callout", payload: { kind: "warning" } },
    ],

    // The parsed HTML carries data-callout — widen the sanitizer for it.
    sanitize: { attributes: { blockquote: ["data-callout"] } },

    markdown: {
      marked: [{
        renderer: {
          // marked v12 renderer: receives the blockquote's inner HTML.
          blockquote(quote: string): string | false {
            const m = /^<p>\s*\[!(\w+)\]\s*(?:<br\s*\/?>\s*|\n)?/i.exec(quote);
            if (!m || !CALLOUT_KINDS.includes(m[1].toLowerCase() as CalloutKind)) return false;
            const kind = m[1].toLowerCase();
            let rest = quote.replace(m[0], "<p>");
            rest = rest.replace(/^<p>\s*<\/p>\s*/, "");
            return `<blockquote data-callout="${kind}">\n${rest}</blockquote>\n`;
          },
        },
      }],
      turndown: (td) => {
        td.addRule("callout", {
          filter: (node) =>
            node.nodeName === "BLOCKQUOTE" && !!(node as HTMLElement).getAttribute("data-callout"),
          replacement: (content, node) => {
            const kind = ((node as HTMLElement).getAttribute("data-callout") ?? "note").toUpperCase();
            const body = content
              .replace(/^\n+|\n+$/g, "")
              .replace(/^/gm, "> ")
              .replace(/^> $/gm, ">");
            return `\n\n> [!${kind}]\n${body}\n\n`;
          },
        });
      },
    },
  });
}
