/**
 * Markdown input rules — the "type-to-format" magic.
 *
 * Two families:
 *   • Block rules fire when a trailing space turns the start of a paragraph
 *     into a heading / list / quote / task / … (`# `, `- `, `1. `, `> `,
 *     `[ ] `, ` ``` `, `--- `).
 *   • Inline rules fire when a closing delimiter completes `**bold**`,
 *     `*italic*`, `` `code` `` or `~~strike~~`.
 *
 * `runInputRules` is called from the editor's `input` handler and returns true
 * when it changed the document (so the editor knows to re-serialise).
 */

import { applyCommand } from "./commands.js";
import {
  currentBlock, currentListItem, getRange, getSelection, textBeforeCaret,
  placeCaretAtStart, placeCaretAfter, deleteLeadingChars,
} from "./dom.js";
import type { Command } from "./types.js";

interface BlockRule {
  re: RegExp;
  cmd: Command;
}

const BLOCK_RULES: BlockRule[] = [
  { re: /^# $/, cmd: "heading1" },
  { re: /^## $/, cmd: "heading2" },
  { re: /^### $/, cmd: "heading3" },
  { re: /^> $/, cmd: "blockquote" },
  { re: /^[-*] $/, cmd: "bulletList" },
  { re: /^\d+\. $/, cmd: "orderedList" },
  { re: /^\[[ xX]?\] $/, cmd: "taskList" },
];

interface InlineRule {
  re: RegExp;
  tag: string;
}

const INLINE_RULES: InlineRule[] = [
  { re: /\*\*([^*\n]+)\*\*$/, tag: "strong" },
  { re: /~~([^~\n]+)~~$/, tag: "del" },
  { re: /`([^`\n]+)`$/, tag: "code" },
  { re: /(?<![*\\])\*([^*\n]+)\*$/, tag: "em" },
  { re: /(?<![_\w])_([^_\n]+)_$/, tag: "em" },
];

export function runInputRules(root: HTMLElement): boolean {
  const block = currentBlock(root);
  if (!block) return false;

  // Block-level rules only apply to plain paragraphs at their very start.
  if (block.tagName === "P") {
    // contentEditable renders a typed trailing space as a non-breaking space,
    // so normalise U+00A0 → " " before matching "# ", "> ", "- ", etc.
    const before = textBeforeCaret(block).replace(/ /g, " ");

    // Fenced code: "``` " → code block.
    if (before === "``` " || before === "``` ") {
      deleteLeadingChars(block, before.length);
      applyCommand(root, "codeBlock");
      return true;
    }
    // Divider: "--- " → horizontal rule.
    if (before === "--- " || before === "___ " || before === "*** ") {
      deleteLeadingChars(block, before.length);
      applyCommand(root, "divider");
      return true;
    }
    for (const rule of BLOCK_RULES) {
      if (rule.re.test(before)) {
        const checked = /\[[xX]\]/.test(before);
        // Convert the still-non-empty block FIRST (execCommand's formatBlock /
        // insertUnorderedList no-op on an empty block), THEN strip the trigger.
        applyCommand(root, rule.cmd);
        const target = currentListItem(root) || currentBlock(root);
        if (target) {
          deleteLeadingChars(target, before.length);
          anchorCaret(target);
        }
        if (rule.cmd === "taskList" && checked) checkCurrentTask(root);
        return true;
      }
    }
  }

  // Inline rules never run inside a code block.
  if (block.tagName === "PRE") return false;
  return runInlineRules();
}

function runInlineRules(): boolean {
  const range = getRange();
  if (!range || !range.collapsed) return false;
  let node = range.startContainer;
  let offset = range.startOffset;
  // Caret parked at an element boundary (e.g. end of a block): dive into the
  // preceding text node so the inline patterns have something to match.
  if (node.nodeType !== Node.TEXT_NODE) {
    const prev = offset > 0 ? node.childNodes[offset - 1] : null;
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      node = prev;
      offset = (prev as Text).data.length;
    } else {
      return false;
    }
  }
  const text = (node as Text).data.slice(0, offset);

  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const inner = m[1];
    // The lookbehind in the `em` rules keeps the guard char out of the match,
    // so `<delim>inner<delim>` is exactly the span to replace.
    const from = offset - matchedDelimiterLength(rule, inner);
    if (from < 0) continue;
    replaceInline(node as Text, from, offset, rule.tag, inner);
    return true;
  }
  return false;
}

/** Length of `<delim>inner<delim>` for the rule that matched. */
function matchedDelimiterLength(rule: InlineRule, inner: string): number {
  const d =
    rule.tag === "strong" ? 2 :
    rule.tag === "del" ? 2 :
    rule.tag === "code" ? 1 :
    1; // em: single * or _
  return inner.length + d * 2;
}

function replaceInline(node: Text, from: number, to: number, tag: string, inner: string): void {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  range.deleteContents();
  const el = document.createElement(tag);
  el.textContent = inner;
  range.insertNode(el);
  // Park the caret AFTER a zero-width space so continued typing lands outside
  // the new mark (otherwise Chrome keeps typing inside the <strong>/<code>).
  // The ZWSP is stripped by the serialiser, so it never reaches the Markdown.
  const tail = document.createTextNode(String.fromCharCode(0x200b));
  el.parentNode?.insertBefore(tail, el.nextSibling);
  const sel = getSelection();
  if (sel) {
    const r = document.createRange();
    r.setStart(tail, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/**
 * Ensure the just-emptied block has a valid caret position and put the caret
 * there. An empty element with no child node is not a placeable caret target —
 * Chrome inserts typed text BEFORE it — so text blocks get a `<br>` and task
 * items get a (zero-width) text node right after the checkbox.
 */
function anchorCaret(target: HTMLElement): void {
  const checkbox = target.querySelector(':scope > input[type="checkbox"]');
  if (checkbox) {
    let tn = checkbox.nextSibling;
    if (!tn || tn.nodeType !== Node.TEXT_NODE) {
      tn = document.createTextNode(String.fromCharCode(0x200b));
      checkbox.after(tn);
    }
    const sel = getSelection();
    if (sel) {
      const r = document.createRange();
      r.setStart(tn, (tn as Text).length);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return;
  }
  // Deleting the trigger can leave an EMPTY TEXT NODE behind; a block whose
  // only content is empty text is not a placeable caret target (Chrome types
  // before it). Normalise such blocks to a single <br> so the caret sticks.
  const zwsp = String.fromCharCode(0x200b);
  const meaningful = (target.textContent ?? "").split(zwsp).join("").length > 0;
  if (!meaningful && !target.querySelector("*")) {
    target.replaceChildren(document.createElement("br"));
  }
  placeCaretAtStart(target);
}

function checkCurrentTask(root: HTMLElement): void {
  const li = currentListItem(root);
  if (!li) return;
  const box = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (box) {
    box.checked = true;
    box.setAttribute("checked", "");
  }
  li.setAttribute("data-task", "done");
}

/** Delete the first `n` characters of a block's text content. */
function deleteLeading(block: HTMLElement, n: number): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = n;
  let endNode: Text | null = null;
  let endOffset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.data.length >= remaining) {
      endNode = node;
      endOffset = remaining;
      break;
    }
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  if (!endNode) return;
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEnd(endNode, endOffset);
  range.deleteContents();
}
