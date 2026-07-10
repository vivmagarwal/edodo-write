/**
 * Keyboard shortcuts and the few Enter/Backspace behaviours contentEditable
 * gets wrong on its own (newlines inside code blocks; collapsing an empty
 * heading/quote/code block back to a paragraph).
 *
 * All formatting funnels through the injected `exec` so the editor can
 * re-serialise + refresh its toolbar after every structural change.
 */

import {
  currentBlock, isAtBlockStart, isBlockEmpty, getRange, placeCaretAfter,
} from "./dom.js";
import type { Command } from "./types.js";

export interface KeymapHandlers {
  exec: (cmd: Command) => void;
  /** Open the link editor (the toolbar owns the URL prompt UI). */
  onLink: () => void;
  /** Signal a content change that isn't a formatting command (re-serialise). */
  notify: () => void;
}

/** Returns true when the event was handled (caller should not do more). */
export function handleKeydown(root: HTMLElement, e: KeyboardEvent, h: KeymapHandlers): boolean {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); h.exec("bold"); return true; }
    if (k === "i") { e.preventDefault(); h.exec("italic"); return true; }
    if (k === "k") { e.preventDefault(); h.onLink(); return true; }
    if (e.shiftKey && k === "7") { e.preventDefault(); h.exec("orderedList"); return true; }
    if (e.shiftKey && k === "8") { e.preventDefault(); h.exec("bulletList"); return true; }
    if (e.shiftKey && k === "9") { e.preventDefault(); h.exec("taskList"); return true; }
    if (e.shiftKey && k === "e") { e.preventDefault(); h.exec("code"); return true; }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    const block = currentBlock(root);
    if (block && block.tagName === "PRE") {
      e.preventDefault();
      insertNewline();
      h.notify(); // re-serialise; do NOT change the block type
      return true;
    }
  }

  if (e.key === "Backspace") {
    const block = currentBlock(root);
    if (!block) return false;
    if (isAtBlockStart(block) && ["H1", "H2", "H3", "BLOCKQUOTE"].includes(block.tagName)) {
      e.preventDefault();
      h.exec("paragraph");
      return true;
    }
    if (block.tagName === "PRE" && isBlockEmpty(block)) {
      e.preventDefault();
      h.exec("codeBlock"); // pre → paragraph
      return true;
    }
  }

  return false;
}

function insertNewline(): void {
  const range = getRange();
  if (!range) return;
  range.deleteContents();
  const nl = document.createTextNode("\n");
  range.insertNode(nl);
  placeCaretAfter(nl);
}
