/**
 * DOM + selection helpers shared by the commands, input-rules, toolbar and
 * slash-menu. Nothing here holds state; every function takes the editor root
 * (the contentEditable element) or a node and reads the live selection.
 */

import type { BlockKind } from "./types.js";

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "TABLE", "DIV",
]);

export function getSelection(): Selection | null {
  return typeof window !== "undefined" ? window.getSelection() : null;
}

export function getRange(): Range | null {
  const sel = getSelection();
  return sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
}

export function selectionInside(root: HTMLElement): boolean {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  return !!node && (root === node || root.contains(node));
}

/** The nearest ancestor element (or self) matching `pred`, bounded by `root`. */
export function closestWithin(
  node: Node | null,
  root: HTMLElement,
  pred: (el: HTMLElement) => boolean,
): HTMLElement | null {
  let el: Node | null = node;
  while (el && el !== root) {
    if (el.nodeType === 1 && pred(el as HTMLElement)) return el as HTMLElement;
    el = el.parentNode;
  }
  return null;
}

/** The top-level block element (direct child of root) containing the caret. */
export function currentBlock(root: HTMLElement): HTMLElement | null {
  const range = getRange();
  if (!range) return null;
  let node: Node | null = range.startContainer;
  if (node === root) {
    // Caret directly on root — pick the child at the offset.
    const child = root.childNodes[range.startOffset] || root.lastChild;
    return (child && child.nodeType === 1 ? (child as HTMLElement) : null);
  }
  while (node && node.parentNode !== root) node = node.parentNode;
  return node && node.nodeType === 1 ? (node as HTMLElement) : null;
}

/** The list item (LI) containing the caret, if any. */
export function currentListItem(root: HTMLElement): HTMLElement | null {
  const range = getRange();
  if (!range) return null;
  return closestWithin(range.startContainer, root, (el) => el.tagName === "LI");
}

export function blockKindOf(el: HTMLElement | null): BlockKind {
  if (!el) return "other";
  switch (el.tagName) {
    case "P": return "paragraph";
    case "H1": return "heading1";
    case "H2": return "heading2";
    case "H3": return "heading3";
    case "H4": return "heading4";
    case "H5": return "heading5";
    case "H6": return "heading6";
    case "BLOCKQUOTE": return "blockquote";
    case "PRE": return "codeBlock";
    case "UL": return el.classList.contains("contains-task-list") ? "taskList" : "bulletList";
    case "OL": return "orderedList";
    default: return "other";
  }
}

export function isBlockTag(el: HTMLElement): boolean {
  return BLOCK_TAGS.has(el.tagName);
}

/** Plain text of the current block from its start up to the caret. */
export function textBeforeCaret(block: HTMLElement): string {
  const range = getRange();
  if (!range) return "";
  const pre = range.cloneRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString();
}

/** Is the caret at the very start of `block` (no text before it)? */
export function isAtBlockStart(block: HTMLElement): boolean {
  return textBeforeCaret(block).length === 0;
}

/** Is `block` effectively empty (no text, no media)? */
export function isBlockEmpty(block: HTMLElement): boolean {
  const text = block.textContent ?? "";
  return text.trim() === "" && !block.querySelector("img,hr,input");
}

export function placeCaretAtStart(el: HTMLElement): void {
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function placeCaretAtEnd(el: HTMLElement): void {
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function placeCaretAfter(node: Node): void {
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Bounding rect of the current selection, or null when unavailable. */
export function selectionRect(): DOMRect | null {
  const range = getRange();
  if (!range) return null;
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[rects.length - 1];
  const r = range.getBoundingClientRect();
  return r.width === 0 && r.height === 0 && r.x === 0 && r.y === 0 ? null : r;
}

/**
 * Delete the first `n` characters of a block's TEXT content. The range is
 * anchored to the first text node (not `(block, 0)`) so leading non-text
 * children — e.g. a task-list checkbox — are never swept into the deletion.
 */
export function deleteLeadingChars(block: HTMLElement, n: number): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = n;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let endOffset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (!startNode) startNode = node;
    if (node.data.length >= remaining) {
      endNode = node;
      endOffset = remaining;
      break;
    }
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, 0);
  range.setEnd(endNode, endOffset);
  range.deleteContents();
}

const ZWSP = String.fromCharCode(0x200b);

/**
 * Ensure an element has a placeable caret target. An element that is empty —
 * or whose only children are empty text nodes (what `Range.extractContents`
 * leaves behind when the caret sits at the end of a text node) — is NOT a valid
 * caret position: Chrome inserts typed text *before* it. Normalise such
 * elements to a single `<br>`.
 */
export function ensureNotEmpty(el: HTMLElement): void {
  const zwsp = String.fromCharCode(0x200b);
  const hasContent = Array.from(el.childNodes).some(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE ||
      (n.nodeType === Node.TEXT_NODE && (n as Text).data.split(zwsp).join("").length > 0),
  );
  if (!hasContent) {
    el.textContent = "";
    el.appendChild(document.createElement("br"));
  }
}

/**
 * The caret's position as a plain-text character offset from the start of
 * `root` (zero-width spaces excluded). Used to restore the caret after an
 * undo/redo re-hydrates the document from Markdown. Returns null if the caret
 * is outside `root`.
 */
export function getCaretOffset(root: HTMLElement): number | null {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer) && range.endContainer !== root) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().split(ZWSP).join("").length;
}

/** Place the caret at a plain-text character offset from the start of `root`. */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const visibleLen = node.data.split(ZWSP).join("").length;
    if (remaining <= visibleLen) {
      const r = document.createRange();
      r.setStart(node, Math.min(remaining, node.data.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    remaining -= visibleLen;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (last) {
    const r = document.createRange();
    r.setStart(last, last.data.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    placeCaretAtStart(root);
  }
}

export function createElement(tag: string, attrs: Record<string, string> = {}, html?: string): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (html !== undefined) el.innerHTML = html;
  return el;
}
