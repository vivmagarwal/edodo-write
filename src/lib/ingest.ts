/**
 * `edodo-write/ingest` — configurable HTML → Markdown (RFC §11).
 *
 * The core `htmlToMarkdown` (from `serialize.ts`) is fixed; hosts that ingest
 * pasted HTML (Word/Gmail, a WYSIWYG paste, an RSS body) need to tune the
 * turndown options, the danger-tag strip-list, and the custom rules without
 * forking. `createHtmlToMarkdown(opts)` mints an ISOLATED turndown instance
 * carrying that config; the module ships the two named rules markdown-composer
 * relies on (`emptyParagraphRule`, `brRule`) as overridable exports.
 *
 * Node-safe: turndown bundles its own DOM parser, so this runs in bare Node /
 * server components / edge (no `document` required). Never throws — a serialise
 * error falls back to a best-effort tag-strip.
 */

import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

export type TurndownOptions = TurndownService.Options;
export type TurndownFilter = TurndownService.Filter;
export type TurndownReplacement = TurndownService.ReplacementFunction;
export interface IngestRule {
  name: string;
  filter: TurndownFilter;
  replacement: TurndownReplacement;
}

export interface IngestOptions {
  /** Turndown option overrides (merged over the defaults below). */
  turndown?: Partial<TurndownOptions>;
  /** GitHub-flavoured Markdown (tables/strikethrough/task-lists). Default true. */
  gfm?: boolean;
  /**
   * Tags whose contents are removed with a DUAL defense: a regex pre-strip over
   * ALL of them, plus `service.remove()` over the non-`head` subset (`head` is a
   * document-special the pre-strip handles). Default: head/script/style/iframe/
   * noscript/object/embed.
   */
  stripTags?: string[];
  /** Extra turndown rules (added after the built-in named rules; may override). */
  rules?: IngestRule[];
  /** Trim the result. Default true. `\n{3,}→\n\n` is applied regardless. */
  trim?: boolean;
}

const DEFAULT_TURNDOWN: TurndownOptions = {
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
  hr: "---",
};

const DEFAULT_STRIP_TAGS = ["head", "script", "style", "iframe", "noscript", "object", "embed"];

/**
 * Drop `<p>` elements that carry no text and no meaningful children — the empty
 * spacer paragraphs Word/Gmail scatter through pasted HTML.
 */
export const emptyParagraphRule: Omit<IngestRule, "name"> = {
  filter: (node) =>
    node.nodeName === "P" &&
    (node.textContent ?? "").trim() === "" &&
    node.querySelector("img") === null,
  replacement: () => "",
};

/**
 * A raw `<br>` OUTSIDE a table cell becomes a single soft newline (`\n`), not
 * turndown's default hard `  \n` break — which the tidy pass would strip and
 * which is invisibly fragile. Table-cell breaks are left to turndown/GFM.
 */
export const brRule: Omit<IngestRule, "name"> = {
  filter: (node) =>
    node.nodeName === "BR" &&
    !(node.parentNode != null && /^(TD|TH)$/.test((node.parentNode as Node).nodeName)),
  replacement: () => "\n",
};

/**
 * First defense: remove paired danger tags AND their contents
 * (`<script>…</script>`, `<head>…</head>`) plus genuinely self-closing forms
 * (`<embed/>`). A bare, UNCLOSED opener (`<script>x`) is deliberately left for
 * turndown's `service.remove()` second defense — stripping the lone opener here
 * would orphan its body as visible text.
 */
function preStrip(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/>`, "gi"), "");
  }
  return out;
}

/**
 * Build an isolated, configured HTML→Markdown converter. Returns the
 * `htmlToMarkdown` function plus the underlying `service` (for further tuning).
 */
export function createHtmlToMarkdown(opts: IngestOptions = {}): {
  htmlToMarkdown: (html: string, o?: { trim?: boolean }) => string;
  service: TurndownService;
} {
  const stripTags = opts.stripTags ?? DEFAULT_STRIP_TAGS;
  const trimDefault = opts.trim !== false;

  const service = new TurndownService({ ...DEFAULT_TURNDOWN, ...opts.turndown });
  if (opts.gfm !== false) service.use(gfm);

  // Second defense: drop danger nodes via turndown (head handled by pre-strip).
  const removable = stripTags.filter((t) => t.toLowerCase() !== "head");
  if (removable.length) service.remove(removable as TurndownService.Filter);

  service.addRule("edodoEmptyParagraph", emptyParagraphRule);
  service.addRule("edodoBr", brRule);
  for (const r of opts.rules ?? []) service.addRule(r.name, { filter: r.filter, replacement: r.replacement });

  const convert = (html: string, o?: { trim?: boolean }): string => {
    const trim = o?.trim ?? trimDefault;
    let md: string;
    try {
      md = service.turndown(preStrip(String(html ?? ""), stripTags));
    } catch {
      // Never throw — best-effort tag strip.
      md = preStrip(String(html ?? ""), stripTags).replace(/<[^>]+>/g, "");
    }
    md = md.replace(/\n{3,}/g, "\n\n"); // always applied, even when trim is off
    return trim ? md.trim() : md;
  };

  return { htmlToMarkdown: (html, o) => convert(html, o), service };
}

/**
 * Heuristic: does `str` look like HTML (worth running through the converter)
 * rather than already-Markdown? Detects an opening/closing tag or a doctype.
 * The host composes its own `detect → convert` (`normalizeBodyToMarkdown`).
 */
export function looksLikeHtml(str: string): boolean {
  if (typeof str !== "string" || str === "") return false;
  return /<([a-z][a-z0-9]*)\b[^>]*>|<\/[a-z][a-z0-9]*\s*>|<!doctype/i.test(str);
}
