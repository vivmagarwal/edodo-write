/**
 * HTML → Markdown.
 *
 * `turndown` (+ the GFM plugin: tables, strikethrough, task lists) turns the
 * `contentEditable` DOM back into clean Markdown. This is the "write" half of
 * the round-trip — the editor calls it on every change so that Markdown, not
 * HTML, is always the value you read out.
 *
 * Instancing: `createMarkdownSerializer` builds a fresh TurndownService so each
 * editor can carry its own plugin rules; the module-level `htmlToMarkdown`
 * stays bound to a default instance for standalone use (`toMarkdown`, tests).
 */

import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

export interface SerializerExtension {
  (td: TurndownService): void;
}

export function createTurndownService(extensions: SerializerExtension[] = []): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
    // Backslash hard breaks (CommonMark). Turndown's default two-space break
    // would be destroyed by the trailing-whitespace tidy below — and invisibly
    // fragile in editors that trim on save.
    br: "\\",
  });
  td.use(gfm);

  // Escape `<` in prose. Turndown's default escaper leaves it alone, so text
  // like "if a<b>c" or a literal "<script>" would be re-parsed as raw HTML (and
  // stripped by the sanitiser). Escaping the tag-opener keeps such text literal
  // while never affecting real markup (which turndown emits via its own rules,
  // not through escape()).
  const baseEscape = td.escape.bind(td);
  td.escape = (str: string) =>
    baseEscape(str)
      .replace(/</g, "\\<")
      // Only an `&` that already forms an entity would be re-parsed; keep plain
      // ampersands ("Tom & Jerry") untouched.
      .replace(/&(?=[a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;");

  // Drop empty paragraphs that `contentEditable` leaves behind (e.g. a bare
  // `<p><br></p>` at the end of the document) so the Markdown stays tidy.
  td.addRule("stripEmptyParagraphs", {
    filter: (node) =>
      node.nodeName === "P" &&
      node.textContent?.trim() === "" &&
      node.querySelector("img") === null,
    replacement: () => "",
  });

  // Preserve underline/mark as plain text (Markdown has no syntax for them) —
  // turndown already unwraps unknown inline tags, this just makes it explicit.
  td.keep(["mark"]);

  for (const extend of extensions) extend(td);

  return td;
}

/**
 * Post-serialization tidy. Fence-aware: the marker/whitespace normalizations
 * must never rewrite the inside of a code fence — pasted code would lose
 * alignment spaces, trailing whitespace, and blank-line runs.
 */
export function tidyMarkdown(md: string): string {
  const lines = md.split(String.fromCharCode(0x200b)).join("").split("\n");
  const out: string[] = [];
  let fence: { char: string; len: number; indent: number } | null = null;
  let blankRun = 0;

  for (let line of lines) {
    const open = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (open) {
      const char = open[2][0];
      const len = open[2].length;
      if (!fence) {
        fence = { char, len, indent: open[1].length };
        line = line.replace(/[ \t]+$/, "");
        out.push(line);
        blankRun = 0;
        continue;
      }
      // A closing fence must match the char and be at least as long.
      if (char === fence.char && len >= fence.len && line.trim() === open[2]) {
        fence = null;
        out.push(line);
        blankRun = 0;
        continue;
      }
    }
    if (fence) {
      out.push(line); // verbatim — never touch fenced content
      continue;
    }
    line = line
      .replace(/ /g, " ")                     // NBSP is a contentEditable artifact, not intent
      .replace(/^(\s*)([-*+])[ \t]+/, "$1$2 ")     // one space after a bullet marker
      .replace(/^(\s*)(\d+)\.[ \t]+/, "$1$2. ")    // one space after an ordered marker
      .replace(/^(\s*(?:[-*+]|\d+\.) \[[ xX]\])[ \t]+/, "$1 ") // one space after a task checkbox
      .replace(/[ \t]+$/, "");                     // trim trailing whitespace
    if (line === "") {
      blankRun += 1;
      if (blankRun >= 2) continue;                 // collapse 3+ blank lines
    } else {
      blankRun = 0;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

export function createMarkdownSerializer(extensions: SerializerExtension[] = []): (html: string) => string {
  const service = createTurndownService(extensions);
  return (html: string) => tidyMarkdown(service.turndown(html || ""));
}

const defaultSerialize = /* lazily */ (() => {
  let fn: ((html: string) => string) | null = null;
  return (html: string) => (fn ??= createMarkdownSerializer())(html);
})();

/** Convert an HTML string to Markdown (default serializer, no extensions). */
export function htmlToMarkdown(html: string): string {
  return defaultSerialize(html);
}
