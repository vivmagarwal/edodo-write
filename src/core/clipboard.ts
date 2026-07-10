/**
 * Clipboard — Markdown in, Markdown out.
 *
 *   • Copy / cut put the selection on the clipboard as BOTH Markdown
 *     (`text/plain`, so pasting into any text field yields Markdown) and HTML
 *     (`text/html`, so pasting into Docs/Word yields rich text).
 *   • Paste accepts either: rich HTML (from the web) is converted to Markdown,
 *     and plain text is treated as Markdown — then parsed and inserted as real
 *     blocks (headings, lists, quotes…), splitting the current block as needed.
 *
 * This is the "façade over Markdown" made tangible: what leaves and enters the
 * editor is always Markdown, while the surface stays rich.
 *
 * Every function takes the editor's OWN pipeline — an editor with plugin
 * markdown extensions must copy/paste through the same codec it renders with,
 * or plugin content silently corrupts on the way through the clipboard. The
 * module-level default (used by the standalone `insertMarkdown` export) is the
 * plain GFM pipeline.
 */

import { parseMarkdown, type ParseOptions } from "./parse.js";
import { htmlToMarkdown } from "./serialize.js";
import { sanitizeHtml } from "./sanitize.js";
import {
  getRange, getSelection, currentBlock, placeCaretAfter, placeCaretAtEnd,
} from "./dom.js";

export interface MarkdownPipeline {
  parse(md: string, opts?: ParseOptions): string;
  serialize(html: string): string;
  sanitize(html: string): string;
}

/** The plain GFM pipeline — no plugin extensions. */
export const defaultPipeline: MarkdownPipeline = {
  parse: parseMarkdown,
  serialize: htmlToMarkdown,
  sanitize: sanitizeHtml,
};

/** Is the pasted plain text a lone URL? (→ link the selection, Notion-style) */
function asLoneUrl(text: string): string | null {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  return null;
}

/** Handle a `copy` or `cut`. Returns true if we took over the event. */
export function handleCopyCut(e: ClipboardEvent, isCut: boolean, pipeline: MarkdownPipeline = defaultPipeline): boolean {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !e.clipboardData) return false;
  const range = sel.getRangeAt(0);
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  const markdown = pipeline.serialize(holder.innerHTML);
  // Regenerate the HTML flavor from the Markdown rather than cloning the live
  // contentEditable DOM — the raw DOM carries editor internals (zero-width
  // caret parks, interactive checkbox inputs, data-task attributes) that must
  // not leak into Docs/Word pastes.
  const html = pipeline.parse(markdown, { decorateTasks: false });
  e.clipboardData.setData("text/plain", markdown);
  e.clipboardData.setData("text/html", html);
  e.preventDefault();
  if (isCut) range.deleteContents();
  return true;
}

/** Handle a `paste`. Returns true if we took over the event. */
export function handlePaste(root: HTMLElement, e: ClipboardEvent, pipeline: MarkdownPipeline = defaultPipeline): boolean {
  if (!e.clipboardData) return false;
  const html = e.clipboardData.getData("text/html");
  const text = e.clipboardData.getData("text/plain");
  e.preventDefault();

  // Pasting a bare URL over a selection turns it into a link (Notion parity).
  const sel = getSelection();
  const url = asLoneUrl(text);
  if (url && sel && !sel.isCollapsed && (!html || !html.trim())) {
    document.execCommand("createLink", false, url);
    return true;
  }

  let markdown: string;
  if (html && html.trim()) {
    markdown = pipeline.serialize(pipeline.sanitize(html));
  } else {
    markdown = text;
  }
  if (!markdown) return true;
  insertMarkdown(root, markdown, pipeline);
  return true;
}

/** Parse Markdown and insert it at the caret, splitting the current block. */
export function insertMarkdown(root: HTMLElement, md: string, pipeline: MarkdownPipeline = defaultPipeline): void {
  const container = document.createElement("div");
  container.innerHTML = pipeline.parse(md);
  const blocks = Array.from(container.children);

  // Inline-only paste (single paragraph, or bare inline) → insert inline.
  if (blocks.length === 0) {
    insertInline(Array.from(container.childNodes));
    return;
  }
  if (blocks.length === 1 && blocks[0].tagName === "P") {
    insertInline(Array.from(blocks[0].childNodes));
    return;
  }
  insertBlocks(root, blocks as HTMLElement[]);
}

function insertInline(nodes: Node[]): void {
  const range = getRange();
  if (!range) return;
  range.deleteContents();
  const frag = document.createDocumentFragment();
  nodes.forEach((n) => frag.appendChild(n.cloneNode(true)));
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) placeCaretAfter(last);
}

function insertBlocks(root: HTMLElement, blocks: HTMLElement[]): void {
  const block = currentBlock(root);
  const clones = blocks.map((b) => b.cloneNode(true) as HTMLElement);

  if (!block) {
    clones.forEach((c) => root.appendChild(c));
    if (clones.length) placeCaretAtEnd(clones[clones.length - 1]);
    return;
  }

  const range = getRange();
  let tail: DocumentFragment | null = null;
  let blockWasEmpty = (block.textContent ?? "").trim() === "";
  if (range) {
    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    tailRange.setEnd(block, block.childNodes.length);
    tail = tailRange.extractContents();
    blockWasEmpty = (block.textContent ?? "").trim() === "";
  }

  let anchor: HTMLElement = block;
  for (const c of clones) { anchor.after(c); anchor = c; }

  if (tail && (tail.textContent ?? "").trim() !== "") {
    const trailing = document.createElement("p");
    trailing.appendChild(tail);
    anchor.after(trailing);
  }
  if (blockWasEmpty) block.remove();

  placeCaretAtEnd(anchor);
}
