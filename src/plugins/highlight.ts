/**
 * Highlight — `==text==` ↔ `<mark>`.
 *
 * The canonical plugin example: ~50 lines that exercise every non-UI
 * extension point (command, input rule, keybinding, toolbar button, and a
 * PAIRED markdown extension). If you are writing your first plugin, start by
 * reading this file top to bottom.
 *
 * Note the markdown pairing: the marked tokenizer that READS `==…==` ships in
 * the same object as the turndown rule that WRITES it back. A parse extension
 * without its serialize twin is a round-trip bug by construction — prove
 * yours with `assertRoundTrip` from `edodo-write/testing`.
 */

import { definePlugin, type EdodoPlugin } from "../lib/index.js";

declare module "../core/types.js" {
  interface CommandPayloads {
    highlight: void;
  }
}

export function highlight(): EdodoPlugin {
  return definePlugin({
    name: "highlight",

    commands: {
      highlight: {
        run: (ctx) => ctx.dom.toggleInlineTag("mark"),
        isActive: (ctx) => ctx.dom.isInlineTagActive("mark"),
      },
    },

    inputRules: [
      { kind: "inline", trigger: /==([^=\n]+)==$/, apply: "mark" },
    ],

    keymap: {
      "Mod-Shift-h": "highlight",
    },

    toolbarItems: [
      { id: "highlight", label: "H", title: "Highlight  (⌘⇧H)", command: "highlight" },
    ],

    markdown: {
      marked: [{
        extensions: [{
          name: "highlight",
          level: "inline",
          start: (src: string) => src.indexOf("=="),
          tokenizer(src: string) {
            const m = /^==([^=\n]+)==/.exec(src);
            if (!m) return undefined;
            return {
              type: "highlight",
              raw: m[0],
              text: m[1],
              tokens: this.lexer.inlineTokens(m[1]),
            };
          },
          renderer(token) {
            return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
          },
        }],
      }],
      turndown: (td) => {
        td.addRule("highlight", {
          filter: "mark",
          replacement: (content) => `==${content}==`,
        });
      },
    },
    // <mark> is already in the sanitizer allow-list; a tag that isn't would
    // need: sanitize: { tags: ["mark"] }
  });
}
