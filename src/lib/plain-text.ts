/**
 * `toPlainText` — Node-safe, plugin-aware Markdown → plain text for SEO
 * `<meta>` descriptions, JSON-LD, OG/Twitter cards, list excerpts, and the
 * email plain-text fallback (RFC §9).
 *
 * Token-based by construction: it walks marked's token tree and emits text —
 * it NEVER renders to HTML and strips (that needs a DOM + the sanitiser). It
 * runs in bare Node / server components / edge. Never throws: on a parse error
 * it falls back to `String(md)` run through the same strip pipeline.
 */

import { Marked } from "marked";
import { corePreset } from "../core/preset.js";
import type { EdodoPlugin } from "../core/types.js";

export interface PlainTextOptions {
  /** Hard cap on RETURNED length, ellipsis counted in the budget. Falsy = no cap. */
  maxLength?: number;
  /** Truncation marker. Default "…"; "" is honoured; only null/undefined → default. */
  ellipsis?: string;
  /** Keep paragraph breaks (email). Default false → single collapsed line (SEO). */
  preserveLineBreaks?: boolean;
  /** Back up to the last space, but only when past halfway. Default true. */
  wordBoundary?: boolean;
  /** Token resolution: mention → @Display, emoji → glyph, file → name, … */
  plugins?: EdodoPlugin[];
  /** Decode the 7-entity map (& < > " ' &#39; &nbsp;). Default true. */
  decodeEntities?: boolean;
  /** Tags whose CONTENTS are dropped. Default script/style/iframe/noscript/object/embed. */
  stripTags?: string[];
}

const DEFAULT_STRIP = ["script", "style", "iframe", "noscript", "object", "embed"];

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(t: string): string {
  return t.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e) => ENTITY_MAP[e] ?? _m);
}

/** Remove paired dangerous tags AND their contents (e.g. `<script>…</script>`). */
function stripDangerousBlocks(src: string, stripTags: string[]): string {
  let out = src;
  for (const tag of stripTags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), "");
  }
  return out;
}

function stripHtml(html: string, stripTags: string[]): string {
  return stripDangerousBlocks(html, stripTags).replace(/<[^>]+>/g, " ");
}

interface Ctx {
  decodeEntities: boolean;
  stripTags: string[];
}

function dec(o: Ctx, t: string): string {
  return o.decodeEntities ? decodeEntities(t) : t;
}

function inline(tokens: any[], o: Ctx): string {
  let s = "";
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        s += Array.isArray(t.tokens) ? inline(t.tokens, o) : dec(o, String(t.text ?? ""));
        break;
      case "escape":
      case "codespan":
        s += dec(o, String(t.text ?? ""));
        break;
      case "strong":
      case "em":
      case "del":
      case "link":
        s += inline(t.tokens ?? [], o);
        break;
      case "br":
        s += " ";
        break;
      case "image":
        s += String(t.text ?? "");
        break;
      case "html":
        s += stripHtml(String(t.text ?? ""), o.stripTags);
        break;
      case "emoji":
        s += String(t.glyph ?? "");
        break;
      default:
        if (String(t.type).startsWith("mention")) {
          const item = t.item ?? {};
          // The visible chip is trigger+display; the trigger is the first char
          // of the stored token (`@[…]` → "@"), recovered from `raw`.
          const trigger = typeof t.raw === "string" && t.raw.length ? t.raw[0] : "@";
          s += `${trigger}${item.display ?? ""}`;
        } else if (Array.isArray(t.tokens)) {
          s += inline(t.tokens, o);
        } else if (typeof t.text === "string") {
          s += dec(o, t.text);
        } else if (typeof t.raw === "string") {
          s += t.raw;
        }
    }
  }
  return s;
}

function block(tokens: any[], o: Ctx): string {
  const blocks: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "space":
      case "table": // tables dropped entirely
      case "def":
        break;
      case "heading": // drop the #, keep the text
      case "paragraph":
        blocks.push(inline(t.tokens ?? [], o));
        break;
      case "text":
        blocks.push(Array.isArray(t.tokens) ? inline(t.tokens, o) : dec(o, String(t.text ?? "")));
        break;
      case "blockquote":
        blocks.push(block(t.tokens ?? [], o));
        break;
      case "code":
        blocks.push(dec(o, String(t.text ?? "")));
        break;
      case "hr":
        blocks.push("\n");
        break;
      case "html": {
        const x = stripHtml(String(t.text ?? ""), o.stripTags).trim();
        if (x) blocks.push(x);
        break;
      }
      case "list": {
        const items = (t.items ?? []).map(
          (it: any) => "- " + block(it.tokens ?? [], o).replace(/\s*\n+\s*/g, " ").trim(),
        );
        blocks.push(items.join("\n"));
        break;
      }
      case "list_item":
        blocks.push("- " + block(t.tokens ?? [], o));
        break;
      default:
        if (Array.isArray(t.tokens)) blocks.push(block(t.tokens, o));
        else if (typeof t.text === "string") blocks.push(dec(o, t.text));
    }
  }
  return blocks.filter((b) => b !== "").join("\n\n");
}

export function toPlainText(md: string | null | undefined, options: PlainTextOptions = {}): string {
  if (md == null || md === "") return "";

  const o: Ctx = {
    decodeEntities: options.decodeEntities !== false,
    stripTags: options.stripTags ?? DEFAULT_STRIP,
  };
  const preserve = options.preserveLineBreaks === true;
  const wordBoundary = options.wordBoundary !== false;
  const ellipsis = options.ellipsis == null ? "…" : options.ellipsis;
  const maxLength = options.maxLength;

  let text: string;
  try {
    const marked = new Marked({ gfm: true, breaks: false });
    for (const p of [corePreset(), ...(options.plugins ?? [])]) {
      for (const ext of p.markdown?.marked ?? []) marked.use(ext);
    }
    // Drop dangerous-tag CONTENTS on the raw source first — marked splits inline
    // HTML into separate tokens, so per-token stripping alone can't reach the
    // body between `<script>` and `</script>`.
    const src = stripDangerousBlocks(String(md), o.stripTags);
    text = block(marked.lexer(src) as any[], o);
  } catch {
    // Never throw — fall back to the raw string through the strip pipeline.
    text = stripHtml(dec(o, String(md)), o.stripTags);
  }

  // Whitespace normalisation.
  if (preserve) {
    text = text
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    text = text.replace(/\s+/g, " ").trim();
  }

  // Unresolved emoji-shaped shortcodes (unknown code, or no emoji plugin) drop
  // their colons. Restricted to codes carrying a letter so numeric runs like
  // "12:30:45" are left intact.
  text = text.replace(/:([a-z0-9_+-]*[a-z_][a-z0-9_+-]*):/gi, "$1");

  // Truncation — ellipsis counted in the budget.
  if (maxLength && text.length > maxLength) {
    const limit = maxLength - ellipsis.length;
    if (limit <= 0) return ellipsis;
    let truncated = text.slice(0, limit);
    if (wordBoundary) {
      const lastSpace = truncated.lastIndexOf(" ");
      if (lastSpace > limit * 0.5) truncated = truncated.slice(0, lastSpace);
    }
    // `slice` cuts on UTF-16 code units, so a cut mid-astral-char (emoji) can
    // leave a dangling high surrogate that renders as U+FFFD. If the last kept
    // unit is a lone high surrogate (0xD800–0xDBFF), drop it so we never emit
    // half a code point.
    const last = truncated.charCodeAt(truncated.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1);
    return truncated + ellipsis;
  }
  return text;
}
