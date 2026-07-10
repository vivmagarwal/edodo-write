/**
 * Keyboard handling.
 *
 * Enter and Backspace are intercepted so the block model stays clean and the
 * feel matches Notion. contentEditable's defaults are unreliable here — e.g.
 * Enter at the end of a heading inserts a stray `<div>` in Chrome — so we do
 * the splits/merges ourselves and always emit proper block elements
 * (`<p>`, `<h1>`, `<li>`, `<blockquote>`), never a `<div>`.
 *
 * Semantics (verified against Notion, adapted to CommonMark):
 *   • Enter at end of / inside a heading → the new block is a paragraph.
 *   • Enter in a list item splits it; Enter in an EMPTY item exits the list.
 *   • Enter in a code block inserts a newline.
 *   • Backspace at the start of a heading/quote → convert to paragraph.
 *   • Backspace at the start of a list item → outdent to a paragraph.
 *   • Backspace at the start of a paragraph → merge into the previous block
 *     (deleting a preceding divider outright).
 */

import {
  currentBlock, currentListItem, getRange, getSelection, isAtBlockStart,
  placeCaretAtStart, placeCaretAfter, ensureNotEmpty,
} from "./dom.js";
import { makeTaskItem } from "./commands.js";
import type { Command } from "./types.js";

export interface KeymapHandlers {
  exec: (cmd: Command) => void;
  onLink: () => void;
  notify: () => void;
  undo: () => void;
  redo: () => void;
}

const ZWSP = String.fromCharCode(0x200b);

/** Returns true when the event was handled (caller should not do more). */
export function handleKeydown(root: HTMLElement, e: KeyboardEvent, h: KeymapHandlers): boolean {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); h.undo(); return true; }
    if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); h.redo(); return true; }
    if (k === "b") { e.preventDefault(); h.exec("bold"); return true; }
    if (k === "i") { e.preventDefault(); h.exec("italic"); return true; }
    if (k === "k") { e.preventDefault(); h.onLink(); return true; }
    if (e.shiftKey && k === "7") { e.preventDefault(); h.exec("orderedList"); return true; }
    if (e.shiftKey && k === "8") { e.preventDefault(); h.exec("bulletList"); return true; }
    if (e.shiftKey && k === "9") { e.preventDefault(); h.exec("taskList"); return true; }
    if (e.shiftKey && k === "e") { e.preventDefault(); h.exec("code"); return true; }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    if (handleEnter(root)) { e.preventDefault(); h.notify(); return true; }
  }
  if (e.key === "Enter" && e.shiftKey) {
    // Soft line break within the block.
    if (insertSoftBreak(root)) { e.preventDefault(); h.notify(); return true; }
  }
  if (e.key === "Backspace") {
    if (handleBackspace(root)) { e.preventDefault(); h.notify(); return true; }
  }
  if (e.key === "Tab") {
    if (handleTab(root, e.shiftKey)) { e.preventDefault(); h.notify(); return true; }
  }
  return false;
}

// ── Enter ──────────────────────────────────────────────────────────────────

function handleEnter(root: HTMLElement): boolean {
  const block = currentBlock(root);
  if (!block) return false;

  if (block.tagName === "PRE") {
    insertText("\n");
    return true;
  }

  const li = currentListItem(root);
  if (li && li.parentElement && /^(UL|OL)$/.test(li.parentElement.tagName)) {
    if (isEmptyItem(li)) {
      exitList(root, li);
    } else {
      splitListItem(li);
    }
    return true;
  }

  splitBlock(block);
  return true;
}

/** Split a block at the caret. The new (after) block is a paragraph for
 *  headings, otherwise the same tag. */
function splitBlock(block: HTMLElement): void {
  const range = getRange();
  if (!range) return;
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(block, block.childNodes.length);
  const frag = after.extractContents();

  // Enter leaves a heading OR a blockquote for a normal paragraph (Notion-like);
  // Shift+Enter adds a soft line break to continue within the block.
  const afterTag = /^(H[1-6]|BLOCKQUOTE)$/.test(block.tagName) ? "p" : block.tagName.toLowerCase();
  const newBlock = document.createElement(afterTag);
  newBlock.appendChild(frag);
  ensureNotEmpty(newBlock);
  ensureNotEmpty(block);
  block.after(newBlock);
  placeCaretAtStart(newBlock);
}

function splitListItem(li: HTMLElement): void {
  const range = getRange();
  if (!range) return;
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(li, li.childNodes.length);
  const frag = after.extractContents();

  const newLi = document.createElement("li");
  newLi.appendChild(frag);
  // Drop any checkbox that got carried into the fragment (shouldn't, it's at start).
  newLi.querySelectorAll(':scope > input[type="checkbox"]').forEach((n) => n.remove());
  ensureNotEmpty(li);
  li.after(newLi);
  if (li.classList.contains("task-list-item")) {
    makeTaskItem(newLi, false);
    const box = newLi.querySelector('input[type="checkbox"]');
    if (box) { placeCaretAfter(box); ensureItemHasText(newLi); return; }
  }
  ensureNotEmpty(newLi);
  placeCaretAtStart(newLi);
}

/** An empty task item needs a text node after the checkbox to type into. */
function ensureItemHasText(li: HTMLElement): void {
  const box = li.querySelector('input[type="checkbox"]');
  if (box && (!box.nextSibling || box.nextSibling.nodeType !== Node.TEXT_NODE)) {
    box.after(document.createTextNode(ZWSP));
  }
}

function exitList(root: HTMLElement, li: HTMLElement): void {
  const list = li.parentElement as HTMLElement;
  const p = document.createElement("p");
  p.innerHTML = "<br>";
  li.remove();
  list.after(p);
  if (!list.querySelector("li")) list.remove();
  placeCaretAtStart(p);
}

function isEmptyItem(li: HTMLElement): boolean {
  const txt = (li.textContent ?? "").split(ZWSP).join("").trim();
  return txt === "" && !li.querySelector("ul,ol");
}

// ── Soft break (Shift+Enter) ─────────────────────────────────────────────────

function insertSoftBreak(root: HTMLElement): boolean {
  const block = currentBlock(root);
  if (!block) return false;
  if (block.tagName === "PRE") { insertText("\n"); return true; }
  const range = getRange();
  if (!range) return false;
  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);
  // A trailing <br> needs a following node to place the caret after.
  const filler = document.createTextNode(ZWSP);
  br.after(filler);
  placeCaretAfter(filler);
  return true;
}

// ── Backspace ────────────────────────────────────────────────────────────────

function handleBackspace(root: HTMLElement): boolean {
  const sel = getSelection();
  if (!sel || !sel.isCollapsed) return false;
  const block = currentBlock(root);
  if (!block) return false;

  const li = currentListItem(root);
  if (li && atStartOfItem(li)) {
    outdentOrUnlist(root, li);
    return true;
  }

  if (!isAtBlockStart(block)) return false;

  if (["H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"].includes(block.tagName)) {
    convertToParagraph(block);
    return true;
  }
  if (block.tagName === "PRE" && (block.textContent ?? "").trim() === "") {
    convertToParagraph(block);
    return true;
  }
  if (block.tagName === "P") {
    return mergeWithPrevious(block);
  }
  return false;
}

function atStartOfItem(li: HTMLElement): boolean {
  const range = getRange();
  if (!range) return false;
  const pre = range.cloneRange();
  pre.selectNodeContents(li);
  pre.setEnd(range.startContainer, range.startOffset);
  // ignore a leading checkbox + zero-width spaces
  return pre.toString().split(ZWSP).join("").length === 0;
}

function convertToParagraph(block: HTMLElement): void {
  const p = document.createElement("p");
  while (block.firstChild) p.appendChild(block.firstChild);
  ensureNotEmpty(p);
  block.replaceWith(p);
  placeCaretAtStart(p);
}

function outdentOrUnlist(root: HTMLElement, li: HTMLElement): void {
  const list = li.parentElement as HTMLElement;
  // Nested one level? Move the item up to the parent list level.
  const parentLi = list.parentElement;
  if (parentLi && parentLi.tagName === "LI") {
    parentLi.after(li);
    if (!list.querySelector("li")) list.remove();
    placeCaretAtStart(li);
    return;
  }
  // Top level: turn the item into a paragraph placed after the list.
  const p = document.createElement("p");
  li.querySelector(':scope > input[type="checkbox"]')?.remove();
  while (li.firstChild) p.appendChild(li.firstChild);
  ensureNotEmpty(p);
  li.remove();
  list.after(p);
  if (!list.querySelector("li")) list.remove();
  placeCaretAtStart(p);
}

function mergeWithPrevious(block: HTMLElement): boolean {
  const prev = block.previousElementSibling as HTMLElement | null;
  if (!prev) return false;
  if (prev.tagName === "HR") { prev.remove(); return true; }
  if (prev.tagName === "PRE") return false; // don't fold prose into code

  let target: HTMLElement = prev;
  if (/^(UL|OL)$/.test(prev.tagName)) {
    target = (prev.querySelector("li:last-child") as HTMLElement) || prev;
  }
  const junction = target.lastChild;
  const empty = (block.textContent ?? "").trim() === "";
  if (!empty) {
    while (block.firstChild) target.appendChild(block.firstChild);
  }
  block.remove();
  if (junction) placeCaretAfter(junction);
  else placeCaretAtStart(target);
  return true;
}

// ── Tab (list indent/outdent) ────────────────────────────────────────────────

function handleTab(root: HTMLElement, shift: boolean): boolean {
  const li = currentListItem(root);
  if (!li) return false;
  const list = li.parentElement as HTMLElement;
  if (shift) {
    const parentLi = list.parentElement;
    if (parentLi && parentLi.tagName === "LI") {
      parentLi.after(li);
      if (!list.querySelector("li")) list.remove();
      placeCaretAtStart(li);
      return true;
    }
    return false; // already top level
  }
  const prev = li.previousElementSibling as HTMLElement | null;
  if (!prev || prev.tagName !== "LI") return false; // can't indent the first item
  let sub = prev.querySelector(":scope > ul, :scope > ol") as HTMLElement | null;
  if (!sub) {
    sub = document.createElement(list.tagName.toLowerCase());
    prev.appendChild(sub);
  }
  sub.appendChild(li);
  placeCaretAtStart(li);
  return true;
}

function insertText(text: string): void {
  const range = getRange();
  if (!range) return;
  range.deleteContents();
  const tn = document.createTextNode(text);
  range.insertNode(tn);
  placeCaretAfter(tn);
}
