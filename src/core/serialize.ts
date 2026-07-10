/**
 * HTML → Markdown.
 *
 * `turndown` (+ the GFM plugin: tables, strikethrough, task lists) turns the
 * `contentEditable` DOM back into clean Markdown. This is the "write" half of
 * the round-trip — the editor calls it on every change so that Markdown, not
 * HTML, is always the value you read out.
 */

import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

function createService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  td.use(gfm);

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

  return td;
}

const service = createService();

/** Convert an HTML string to Markdown. */
export function htmlToMarkdown(html: string): string {
  const md = service.turndown(html || "");
  return md
    .replace(/​/g, "")           // drop caret-parking zero-width spaces
    .replace(/^(\s*)([-*+])\s+/gm, "$1$2 ")     // one space after a bullet marker
    .replace(/^(\s*)(\d+)\.\s+/gm, "$1$2. ")    // one space after an ordered marker
    .replace(/(\[[ xX]\])\s+/g, "$1 ")           // one space after a task checkbox
    .replace(/\n{3,}/g, "\n\n")            // collapse 3+ blank lines
    .replace(/[ \t]+$/gm, "")             // trim trailing whitespace
    .trim();
}
