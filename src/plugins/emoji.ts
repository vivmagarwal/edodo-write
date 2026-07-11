/**
 * Emoji — `:shortcode:` ↔ a glyph chip.
 *
 * The stored form is the shortcode itself (`:rocket:`), so the Markdown stays
 * lossless plain text and degrades perfectly in editors without the plugin.
 * The visible node is the glyph, but the paired marked+turndown extension keeps
 * the shortcode on the chip (`data-shortcode`) so it round-trips byte-stable:
 *
 *   parse:      `:rocket:` → `<span class="ew-emoji" data-shortcode="rocket">🚀</span>`
 *   serialize:  that span   → `:rocket:`
 *
 * Grammar: `/:([a-z0-9_+-]+):/i`, looked up lowercased against `map`. An
 * UNKNOWN shortcode is left completely alone — `:nope:` survives verbatim (the
 * tokenizer refuses to consume a code the map doesn't know).
 *
 * `storedForm: "unicode"` serialises the bare glyph instead (no reverse rule
 * needed — the glyph is plain text).
 *
 * The host owns the map — the package ships none. Typing a completed
 * `:shortcode:` for a KNOWN code converts it to a chip in the live editor
 * (unknown codes never convert, so times like "12:30:45" are safe).
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { escapeAttr } from "./widget.js";

export interface EmojiOptions {
  /** shortcode → glyph. The host supplies this (e.g. a `{ rocket: "🚀" }` map). */
  map: Record<string, string>;
  /** Delimiter character. Default: ":". */
  trigger?: string;
  /**
   * Reserved for the interactive `:query` suggestion menu. Accepted now so the
   * stored contract is stable; default true.
   */
  autocomplete?: boolean;
  /** Reserved for the browse-all emoji picker panel. Default: true. */
  picker?: boolean;
  /**
   * How the emoji is stored/serialised. Default "shortcode" (`:name:`);
   * "unicode" serialises the bare glyph.
   */
  storedForm?: "shortcode" | "unicode";
  /** Build the chip Node (defaults to `span.ew-emoji`). Used for live typing. */
  render?: (glyph: string, code: string) => Node;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function emoji(options: EmojiOptions): EdodoPlugin {
  const map = options.map ?? {};
  const trigger = options.trigger ?? ":";
  const shortcodeStored = (options.storedForm ?? "shortcode") !== "unicode";
  const t = escapeRegExp(trigger);
  // Grammar: `:([a-z0-9_+-]+):` (case-insensitive; lowercased on lookup).
  const codeRe = new RegExp(`^${t}([a-z0-9_+-]+)${t}`, "i");
  const rendered = new WeakSet<Node>();

  const chipHtml = (code: string, glyph: string): string =>
    `<span class="ew-emoji" data-shortcode="${escapeAttr(code)}">${escapeAttr(glyph)}</span>`;

  const chipNode = (code: string, glyph: string): Node => {
    if (options.render) return options.render(glyph, code);
    const span = document.createElement("span");
    span.className = "ew-emoji";
    span.setAttribute("data-shortcode", code);
    span.textContent = glyph;
    return span;
  };

  // Type-to-replace only KNOWN codes — an alternation of the map keys, so an
  // unknown `:foo:` never matches and is never eaten.
  const keys = Object.keys(map);
  const inputRules = keys.length
    ? [{
        kind: "inline" as const,
        trigger: new RegExp(`${t}(${keys.map(escapeRegExp).join("|")})${t}$`, "i"),
        apply: (m: RegExpExecArray): Node => {
          const code = m[1].toLowerCase();
          const glyph = map[code] ?? "";
          return shortcodeStored ? chipNode(code, glyph) : document.createTextNode(glyph);
        },
      }]
    : [];

  // Live-editor pass: honour a custom `render` for stored chips arriving via a
  // setMarkdown parse. Runs OUTSIDE transact — the data-shortcode is preserved,
  // so the serialized value is unchanged (same precedent as the tags decorate).
  const decorate = (ctx: EditorContext): void => {
    if (!options.render || !shortcodeStored) return;
    ctx.root.querySelectorAll<HTMLElement>("span[data-shortcode]").forEach((span) => {
      if (rendered.has(span)) return;
      const code = span.getAttribute("data-shortcode") ?? "";
      const glyph = map[code.toLowerCase()] ?? span.textContent ?? "";
      const node = options.render!(glyph, code);
      rendered.add(node);
      span.replaceWith(node);
    });
  };

  const plugin: EdodoPlugin = {
    name: "emoji",

    inputRules,

    markdown: {
      marked: [{
        extensions: [{
          name: "emoji",
          level: "inline",
          start: (src: string) => src.indexOf(trigger),
          tokenizer(src: string) {
            const m = codeRe.exec(src);
            if (!m) return undefined;
            const code = m[1].toLowerCase();
            const glyph = map[code];
            if (!glyph) return undefined; // unknown shortcode → literal passthrough
            return { type: "emoji", raw: m[0], code, glyph };
          },
          renderer(token) {
            const code = String(token.code);
            const glyph = String(token.glyph);
            return shortcodeStored ? chipHtml(code, glyph) : escapeAttr(glyph);
          },
        }],
      }],
      turndown: shortcodeStored
        ? (td) => {
            td.addRule("emoji", {
              filter: (node) =>
                node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute("data-shortcode"),
              replacement: (_content, node) =>
                `${trigger}${(node as HTMLElement).getAttribute("data-shortcode") ?? ""}${trigger}`,
            });
          }
        : undefined,
    },

    setup: (ctx) => {
      decorate(ctx);
    },

    on: {
      change: (_md, ctx) => decorate(ctx),
    },
  };

  if (shortcodeStored) {
    plugin.sanitize = { tags: ["span"], attributes: { span: ["data-shortcode"] } };
  }

  return definePlugin(plugin);
}
