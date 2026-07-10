/**
 * Formatting commands. `applyCommand` is the single entry point the toolbar,
 * slash-menu, keymap and public `editor.exec()` all funnel through.
 *
 * Inline marks (bold/italic/strike) use `document.execCommand` — deprecated but
 * consistent across browsers and wired into native undo. Block transforms are
 * hand-rolled DOM: `execCommand('formatBlock' | 'insertUnorderedList' | …)` is
 * silently dropped by Chrome when called synchronously inside an `input` event
 * (exactly where the Markdown input-rules run), so we never rely on it for
 * structure. Manual DOM also gives predictable, testable output.
 */

import type { Command } from "./types.js";
import {
  getRange, getSelection, currentBlock, currentListItem, closestWithin,
  createElement, placeCaretAtEnd, ensureNotEmpty,
} from "./dom.js";

export function applyCommand(root: HTMLElement, cmd: Command, payload?: { href?: string | null }): void {
  root.focus();
  switch (cmd) {
    case "bold": document.execCommand("bold"); break;
    case "italic": document.execCommand("italic"); break;
    case "strike": document.execCommand("strikeThrough"); break;
    case "code": toggleInlineCode(root); break;
    case "link": applyLink(root, payload?.href); break;
    case "clear": clearFormatting(root); break;
    case "paragraph": setBlock(root, "P"); break;
    case "heading1": setBlock(root, "H1"); break;
    case "heading2": setBlock(root, "H2"); break;
    case "heading3": setBlock(root, "H3"); break;
    case "bulletList": toList(root, { ordered: false }); break;
    case "orderedList": toList(root, { ordered: true }); break;
    case "taskList": toList(root, { ordered: false, task: true }); break;
    case "blockquote": toggleBlockquote(root); break;
    case "codeBlock": toggleCodeBlock(root); break;
    case "divider": insertDivider(root); break;
  }
}

/** True when the given inline mark is active at the current selection. */
export function isInlineActive(root: HTMLElement, kind: "bold" | "italic" | "strike" | "code" | "link"): boolean {
  const range = getRange();
  if (kind === "bold") return safeState("bold");
  if (kind === "italic") return safeState("italic");
  if (kind === "strike") return safeState("strikeThrough");
  if (!range) return false;
  const tag = kind === "code" ? "CODE" : "A";
  return !!closestWithin(range.startContainer, root, (el) => el.tagName === tag);
}

function safeState(cmd: string): boolean {
  try { return document.queryCommandState(cmd); } catch { return false; }
}

// ── Small DOM helpers ──────────────────────────────────────────────────────

function moveChildren(from: Node, to: Node): void {
  while (from.firstChild) to.appendChild(from.firstChild);
}

const BLOCK_TAGS_RE = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR)$/;

// ── Block transforms (all manual DOM) ──────────────────────────────────────

/** Retag the current block. Toggling to the same tag reverts to a paragraph. */
function setBlock(root: HTMLElement, tag: string): void {
  const block = currentBlock(root);
  if (!block) return;
  const target = block.tagName === tag ? "P" : tag;
  if (block.tagName === target) return;
  const el = document.createElement(target);
  moveChildren(block, el);
  ensureNotEmpty(el);
  block.replaceWith(el);
  // Restore the caret INTO the new block — moving the nodes that held the
  // selection can drop it, leaving later steps (and typing) outside the block.
  placeCaretAtEnd(el);
}

function toggleBlockquote(root: HTMLElement): void {
  const block = currentBlock(root);
  if (!block) return;
  if (block.tagName === "BLOCKQUOTE") {
    const frag = document.createDocumentFragment();
    const childrenAreBlocks = block.children.length > 0 &&
      Array.from(block.children).every((c) => BLOCK_TAGS_RE.test(c.tagName));
    if (childrenAreBlocks) {
      moveChildren(block, frag);
    } else {
      const p = document.createElement("p");
      moveChildren(block, p);
      ensureNotEmpty(p);
      frag.appendChild(p);
    }
    block.replaceWith(frag);
    return;
  }
  const bq = document.createElement("blockquote");
  moveChildren(block, bq);
  ensureNotEmpty(bq);
  block.replaceWith(bq);
  placeCaretAtEnd(bq);
}

function toList(root: HTMLElement, opts: { ordered: boolean; task?: boolean }): void {
  const block = currentBlock(root);
  if (!block) return;

  if (block.tagName === "UL" || block.tagName === "OL") {
    // Upgrade a plain bullet list to a task list…
    if (opts.task && block.tagName === "UL" && !block.classList.contains("contains-task-list")) {
      block.classList.add("contains-task-list");
      block.querySelectorAll(":scope > li").forEach((li) => makeTaskItem(li as HTMLElement));
      return;
    }
    // …otherwise toggle the list off (unwrap to paragraphs).
    unwrapList(block);
    return;
  }

  const list = document.createElement(opts.ordered ? "ol" : "ul");
  const li = document.createElement("li");
  moveChildren(block, li);
  ensureNotEmpty(li);
  list.appendChild(li);
  if (opts.task) {
    list.classList.add("contains-task-list");
    makeTaskItem(li);
  }
  block.replaceWith(list);
  placeCaretAtEnd(li);
}

function unwrapList(list: HTMLElement): void {
  const frag = document.createDocumentFragment();
  list.querySelectorAll(":scope > li").forEach((li) => {
    li.querySelector(':scope > input[type="checkbox"]')?.remove();
    const p = document.createElement("p");
    moveChildren(li, p);
    ensureNotEmpty(p);
    frag.appendChild(p);
  });
  list.replaceWith(frag);
}

export function makeTaskItem(li: HTMLElement, checked = false): void {
  li.classList.add("task-list-item");
  li.setAttribute("data-task", checked ? "done" : "todo");
  if (!li.querySelector(':scope > input[type="checkbox"]')) {
    const box = createElement("input", { type: "checkbox" }) as HTMLInputElement;
    box.checked = checked;
    if (checked) box.setAttribute("checked", "");
    li.prepend(box);
  }
}

function insertDivider(root: HTMLElement): void {
  const block = currentBlock(root) || (root.lastElementChild as HTMLElement | null);
  const hr = document.createElement("hr");
  const p = createElement("p", {}, "<br>");
  if (block) {
    block.after(hr);
    hr.after(p);
    if ((block.textContent ?? "").trim() === "" && block.tagName === "P") block.remove();
  } else {
    root.append(hr, p);
  }
  placeCaretAtStartOf(p);
}

function toggleCodeBlock(root: HTMLElement): void {
  const block = currentBlock(root);
  if (!block) return;
  if (block.tagName === "PRE") {
    const p = createElement("p");
    p.textContent = block.textContent || "";
    if (!p.textContent) p.innerHTML = "<br>";
    block.replaceWith(p);
    placeCaretAtEnd(p);
    return;
  }
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.textContent || "";
  pre.appendChild(code);
  block.replaceWith(pre);
  placeCaretAtEnd(code);
}

function placeCaretAtStartOf(el: HTMLElement): void {
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Inline transforms ─────────────────────────────────────────────────────

function toggleInlineCode(root: HTMLElement): void {
  const range = getRange();
  if (!range) return;
  const existing = closestWithin(range.startContainer, root, (el) => el.tagName === "CODE");
  if (existing) {
    unwrap(existing);
    return;
  }
  if (range.collapsed) return;
  wrapRange(range, "code");
}

function applyLink(root: HTMLElement, href?: string | null): void {
  const range = getRange();
  if (!range) return;
  const existing = closestWithin(range.startContainer, root, (el) => el.tagName === "A");
  if (href == null || href === "") {
    if (existing) document.execCommand("unlink");
    return;
  }
  if (range.collapsed && !existing) {
    const a = createElement("a", { href }, href);
    range.insertNode(a);
    placeCaretAtEnd(a);
    return;
  }
  document.execCommand("createLink", false, href);
}

function clearFormatting(root: HTMLElement): void {
  document.execCommand("removeFormat");
  const range = getRange();
  const code = range && closestWithin(range.startContainer, root, (el) => el.tagName === "CODE");
  if (code) unwrap(code);
}

function wrapRange(range: Range, tag: string): void {
  const wrapper = document.createElement(tag);
  try {
    range.surroundContents(wrapper);
  } catch {
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
  }
  const sel = getSelection();
  if (sel) {
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(wrapper);
    sel.addRange(r);
  }
}

function unwrap(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const frag = range.extractContents();
  const first = frag.firstChild;
  const last = frag.lastChild;
  parent.replaceChild(frag, el);
  const sel = getSelection();
  if (sel && first && last) {
    const r = document.createRange();
    r.setStartBefore(first);
    r.setEndAfter(last);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}
