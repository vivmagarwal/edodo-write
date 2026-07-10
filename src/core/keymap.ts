/**
 * Keyboard handling.
 *
 * Two tiers:
 *   1. REGISTERED BINDINGS (core preset + plugins, priority-ordered): Mod-b,
 *      Mod-Shift-8, a plugin's Mod-Shift-H, … — data, fully pluggable.
 *   2. THE ENGINE (this module, not pluggable): Enter/Backspace/Tab structural
 *      semantics, undo/redo routing, and the Mod-U underline swallow. These
 *      keep the block model clean — contentEditable's defaults are unreliable
 *      here (e.g. Enter at the end of a heading inserts a stray `<div>` in
 *      Chrome), so we do the splits/merges ourselves and always emit proper
 *      block elements (`<p>`, `<h1>`, `<li>`, `<blockquote>`), never a `<div>`.
 *      Plugins can PRE-EMPT engine keys (a binding for "Enter" runs first) but
 *      never remove them.
 *
 * Semantics (verified against Notion, adapted to CommonMark):
 *   • Enter at end of / inside a heading → the new block is a paragraph.
 *   • Enter in a list item splits it; Enter in an EMPTY item exits the list.
 *   • Enter in a code block inserts a newline; on a table it escapes below.
 *   • Backspace at the start of a heading/quote → convert to paragraph.
 *   • Backspace at the start of a list item → outdent to a paragraph.
 *   • Backspace at the start of a paragraph → merge into the previous block
 *     (deleting a preceding divider outright; never merging into a table).
 */

import {
  currentBlock, currentListItem, getRange, getSelection, isAtBlockStart,
  placeCaretAtStart, placeCaretAtEnd, placeCaretAfter, ensureNotEmpty,
} from "./dom.js";
import { makeTaskItem } from "./commands.js";
import { guard, matchesKey, type ResolvedKeyBinding } from "./plugin.js";
import type { EditorContext } from "./types.js";

export interface KeymapHandlers {
  notify: () => void;
  undo: () => void;
  redo: () => void;
}

const ZWSP = String.fromCharCode(0x200b);

/** Returns true when the event was handled (caller should not do more). */
export function handleKeydown(
  root: HTMLElement,
  e: KeyboardEvent,
  h: KeymapHandlers,
  bindings: ResolvedKeyBinding[],
  ctx: EditorContext,
): boolean {
  // Tier 1: registered bindings, priority-ordered; first one that acts wins.
  for (const b of bindings) {
    if (!matchesKey(b.descriptor, e)) continue;
    const handled = guard(b.plugin, "keymap", () => {
      if (typeof b.binding === "string") return ctx.exec(b.binding as string);
      return b.binding(ctx, e);
    });
    if (handled) {
      e.preventDefault();
      return true;
    }
  }

  // Tier 2: the engine.
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); h.undo(); return true; }
    if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); h.redo(); return true; }
    // Swallow the browser's native underline — Markdown has no underline, so
    // the <u> it inserts would silently vanish from the serialized value.
    if (k === "u" && !e.shiftKey) { e.preventDefault(); return true; }
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
    insertCodeNewline();
    return true;
  }

  // Table cells: Enter moves DOWN a row (Notion). From the last row it
  // escapes to a paragraph below — never splits the <table> element.
  if (block.tagName === "TABLE") {
    const cell = currentTableCell(root);
    if (cell) {
      const below = cellBelow(cell);
      if (below) {
        placeCaretAtStart(below);
        return true;
      }
    }
    const p = document.createElement("p");
    p.innerHTML = "<br>";
    block.after(p);
    placeCaretAtStart(p);
    return true;
  }

  // Widget figures (diagrams, embeds…) are non-editable islands — Enter
  // escapes to a paragraph below instead of splitting the element.
  if (block.tagName === "FIGURE") {
    const p = document.createElement("p");
    p.innerHTML = "<br>";
    block.after(p);
    placeCaretAtStart(p);
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
  if (block.tagName === "PRE") { insertCodeNewline(); return true; }
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
  if (block.tagName === "PRE" && (block.textContent ?? "").split(ZWSP).join("").trim() === "") {
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
  // Top level: turn the item into a paragraph IN PLACE — items before it stay
  // in this list, items after it move to a new list following the paragraph
  // (splitting a middle item must not reorder the document).
  const p = document.createElement("p");
  li.querySelector(':scope > input[type="checkbox"]')?.remove();
  while (li.firstChild) p.appendChild(li.firstChild);
  ensureNotEmpty(p);
  const following: Element[] = [];
  for (let sib = li.nextElementSibling; sib; sib = sib.nextElementSibling) following.push(sib);
  li.remove();
  list.after(p);
  if (following.length) {
    const tail = document.createElement(list.tagName.toLowerCase());
    if (list.classList.contains("contains-task-list")) tail.classList.add("contains-task-list");
    following.forEach((item) => tail.appendChild(item));
    p.after(tail);
  }
  if (!list.querySelector("li")) list.remove();
  placeCaretAtStart(p);
}

function mergeWithPrevious(block: HTMLElement): boolean {
  const prev = block.previousElementSibling as HTMLElement | null;
  if (!prev) return false;
  if (prev.tagName === "HR") { prev.remove(); return true; }
  if (prev.tagName === "FIGURE") { prev.remove(); return true; } // delete the widget (undoable), Notion-style
  if (prev.tagName === "PRE") return false;   // don't fold prose into code
  if (prev.tagName === "TABLE") return true;  // never fold prose into a table (consume, no-op)

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

// ── Tables (cell navigation + structure helpers) ────────────────────────────

/** The <td>/<th> containing the caret, if any. */
export function currentTableCell(root: HTMLElement): HTMLElement | null {
  const range = getRange();
  if (!range) return null;
  let node: Node | null = range.startContainer;
  while (node && node !== root) {
    if (node.nodeType === 1 && /^(TD|TH)$/.test((node as HTMLElement).tagName)) {
      return node as HTMLElement;
    }
    node = node.parentNode;
  }
  return null;
}

function cellsOf(table: HTMLElement): HTMLElement[] {
  return Array.from(table.querySelectorAll("td, th"));
}

function cellBelow(cell: HTMLElement): HTMLElement | null {
  const row = cell.closest("tr");
  const table = cell.closest("table");
  if (!row || !table) return null;
  const rows = Array.from(table.querySelectorAll("tr"));
  const rowIndex = rows.indexOf(row as HTMLTableRowElement);
  const cellIndex = Array.from(row.children).indexOf(cell);
  const nextRow = rows[rowIndex + 1];
  return (nextRow?.children[cellIndex] as HTMLElement) ?? null;
}

/** Append a body row modeled on the table's column count. Returns its first cell. */
export function appendTableRow(table: HTMLElement): HTMLElement {
  const body = table.querySelector("tbody") ?? table;
  const cols = table.querySelector("tr")?.children.length ?? 1;
  const tr = document.createElement("tr");
  for (let i = 0; i < cols; i++) {
    const td = document.createElement("td");
    td.appendChild(document.createElement("br"));
    tr.appendChild(td);
  }
  body.appendChild(tr);
  return tr.firstElementChild as HTMLElement;
}

/** Tab / Shift+Tab inside a table: hop cells; Tab in the LAST cell adds a row. */
function handleTableTab(root: HTMLElement, shift: boolean): boolean {
  const cell = currentTableCell(root);
  if (!cell) return false;
  const table = cell.closest("table") as HTMLElement;
  const cells = cellsOf(table);
  const index = cells.indexOf(cell);
  if (shift) {
    if (index <= 0) return true; // consume — never outdent out of a table
    placeCaretAtEnd(cells[index - 1]);
    return true;
  }
  if (index === cells.length - 1) {
    placeCaretAtStart(appendTableRow(table));
    return true;
  }
  placeCaretAtStart(cells[index + 1]);
  return true;
}

// ── Tab (list indent/outdent) ────────────────────────────────────────────────

function handleTab(root: HTMLElement, shift: boolean): boolean {
  if (handleTableTab(root, shift)) return true;
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

/**
 * A newline inside a code block. A trailing "\n" at the end of a <pre> is a
 * line TERMINATOR to the browser, not a new line — Chrome types the next
 * character before it. Inserting "\n" + a zero-width space (stripped on
 * serialize) makes the new line real and the caret placeable on it.
 */
export function insertCodeNewline(): void {
  const range = getRange();
  if (!range) return;
  range.deleteContents();
  const tn = document.createTextNode("\n" + ZWSP);
  range.insertNode(tn);
  const sel = getSelection();
  if (sel) {
    const r = document.createRange();
    r.setStart(tn, 1); // between the newline and the ZWSP
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}
