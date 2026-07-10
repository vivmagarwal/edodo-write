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
 */

import { parseMarkdown } from "./parse.js";
import { htmlToMarkdown } from "./serialize.js";
import { sanitizeHtml } from "./sanitize.js";
import {
  getRange, getSelection, currentBlock, placeCaretAfter, placeCaretAtEnd,
} from "./dom.js";

/** Handle a `copy` or `cut`. Returns true if we took over the event. */
export function handleCopyCut(e: ClipboardEvent, isCut: boolean): boolean {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !e.clipboardData) return false;
  const range = sel.getRangeAt(0);
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  const html = holder.innerHTML;
  const markdown = htmlToMarkdown(html);
  e.clipboardData.setData("text/plain", markdown);
  e.clipboardData.setData("text/html", html);
  e.preventDefault();
  if (isCut) range.deleteContents();
  return true;
}

/** Handle a `paste`. Returns true if we took over the event. */
export function handlePaste(root: HTMLElement, e: ClipboardEvent): boolean {
  if (!e.clipboardData) return false;
  const html = e.clipboardData.getData("text/html");
  const text = e.clipboardData.getData("text/plain");
  e.preventDefault();

  let markdown: string;
  if (html && html.trim()) {
    markdown = htmlToMarkdown(sanitizeHtml(html));
  } else {
    markdown = text;
  }
  if (!markdown) return true;
  insertMarkdown(root, markdown);
  return true;
}

/** Parse Markdown and insert it at the caret, splitting the current block. */
export function insertMarkdown(root: HTMLElement, md: string): void {
  const container = document.createElement("div");
  container.innerHTML = parseMarkdown(md);
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
