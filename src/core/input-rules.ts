/**
 * Markdown input rules — the "type-to-format" magic.
 *
 * Two families:
 *   • Block rules fire when a trailing space turns the start of a block into
 *     a heading / list / quote / task / … (`# `, `- `, `1. `, `> `, `[ ] `,
 *     ` ``` `, `--- `).
 *   • Inline rules fire when a closing delimiter completes `**bold**`,
 *     `*italic*`, `` `code` `` or `~~strike~~`.
 *
 * The rule SETS live in the core preset (`preset.ts`) and plugins; this module
 * is the RUNNER. It owns the contentEditable gotchas so no rule author ever
 * has to learn them:
 *   • a typed trailing space arrives as U+00A0 — normalized before matching;
 *   • the block must be converted BEFORE the trigger text is deleted
 *     (commands no-op on empty blocks);
 *   • trigger deletion is anchored to the first TEXT node (a task checkbox
 *     must never be swept into it);
 *   • the emptied block needs a caret re-anchor (`<br>`, or a zero-width text
 *     node after a task checkbox);
 *   • a fresh inline mark parks the caret outside itself with a ZWSP.
 *
 * `runInputRules` is called from the editor's `input` handler and returns true
 * when it changed the document (so the editor knows to re-serialise).
 */

import { applyCommand } from "./commands.js";
import type { EditorContext } from "./types.js";
import type { OwnedBlockRule, OwnedInlineRule } from "./plugin.js";
import { guard, resolvePlugins } from "./plugin.js";
import { corePreset } from "./preset.js";
import {
  currentBlock, currentListItem, getRange, getSelection, textBeforeCaret,
  placeCaretAtStart,
} from "./dom.js";
import { deleteLeadingChars } from "./dom.js";

const ZWSP = String.fromCharCode(0x200b);

export interface RuleSet {
  block: OwnedBlockRule[];
  inline: OwnedInlineRule[];
}

/**
 * Legacy/headless convenience: `runInputRules(root)` uses the core preset's
 * rules with a minimal context (no editor instance required).
 */
export function runInputRules(root: HTMLElement, rules?: RuleSet, ctx?: EditorContext): boolean {
  if (!rules || !ctx) {
    const d = defaultSetup();
    rules ??= d.rules;
    ctx ??= d.ctxFor(root);
  }
  const block = currentBlock(root);
  if (!block) return false;

  // Block rules: normalize the typed text once, for every rule. NBSP only —
  // trigger lengths must count real DOM characters, so ZWSP is not stripped.
  const tag = block.tagName;
  if (tag !== "PRE") {
    const before = textBeforeCaret(block).replace(/ /g, " ");
    for (const rule of rules.block) {
      const within = rule.within ?? ["P"];
      if (!within.includes(tag)) continue;
      const m = rule.trigger.exec(before);
      if (!m) continue;
      const changed = guard(rule.plugin, "inputRules", () => {
        if (typeof rule.apply === "string") {
          applyBlockTrigger(root, rule.apply, before.length, ctx);
          return true;
        }
        return rule.apply(ctx, m, block);
      });
      if (changed) return true;
    }
  }

  // Inline rules never run inside a code block.
  if (tag === "PRE") return false;
  return runInlineRules(rules.inline, ctx);
}

/**
 * The shared block-trigger executor: convert the (still non-empty) block
 * FIRST, then strip the trigger text, then re-anchor the caret. This exact
 * order is load-bearing — see the module header.
 */
export function applyBlockTrigger(
  root: HTMLElement,
  cmd: string,
  triggerLength: number,
  ctx: EditorContext,
): void {
  const before = textBeforeCaret(currentBlock(root) ?? root).replace(/ /g, " ");
  const checked = cmd === "taskList" && /\[[xX]\]/.test(before);
  // One transaction: without it the exec would commit a history snapshot of
  // the half-done state (block converted, trigger text still present).
  ctx.transact(() => {
    ctx.exec(cmd);
    const target = currentListItem(root) || currentBlock(root);
    if (target) {
      deleteLeadingChars(target, triggerLength);
      anchorCaret(target);
    }
    if (checked) checkCurrentTask(root);
  });
}

// ── Inline rules ────────────────────────────────────────────────────────────

function runInlineRules(rules: OwnedInlineRule[], ctx: EditorContext): boolean {
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

  for (const rule of rules) {
    const m = rule.trigger.exec(text);
    if (!m) continue;
    // The rules' lookbehinds keep any guard char out of the match, so m[0]
    // is exactly the `<delim>inner<delim>` span to replace.
    const from = offset - m[0].length;
    if (from < 0) continue;
    const handled = guard(rule.plugin, "inputRules", () => {
      const el = typeof rule.apply === "string"
        ? markElement(rule.apply, m[1] ?? m[0])
        : rule.apply(m);
      replaceInlineSpan(node as Text, from, offset, el);
      return true;
    });
    if (handled) return true;
  }
  return false;
}

function markElement(tag: string, inner: string): Node {
  const el = document.createElement(tag);
  el.textContent = inner;
  return el;
}

/**
 * Replace `[from, to)` of a text node with `el`, then park the caret AFTER a
 * zero-width space so continued typing lands outside the new mark (otherwise
 * Chrome keeps typing inside the <strong>/<code>). The ZWSP is stripped by
 * the serialiser, so it never reaches the Markdown.
 */
export function replaceInlineSpan(node: Text, from: number, to: number, el: Node): void {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  range.deleteContents();
  range.insertNode(el);
  const tail = document.createTextNode(ZWSP);
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
export function anchorCaret(target: HTMLElement): void {
  const checkbox = target.querySelector(':scope > input[type="checkbox"]');
  if (checkbox) {
    let tn = checkbox.nextSibling;
    if (!tn || tn.nodeType !== Node.TEXT_NODE) {
      tn = document.createTextNode(ZWSP);
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
  if (target.tagName === "PRE") {
    // Anchor inside the <code>, on a zero-width text node — a <br> here would
    // mean a newline.
    const code = target.querySelector("code") ?? target;
    if (!code.firstChild) code.appendChild(document.createTextNode(ZWSP));
    const sel = getSelection();
    if (sel && code.lastChild) {
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return;
  }
  // Deleting the trigger can leave an EMPTY TEXT NODE behind; a block whose
  // only content is empty text is not a placeable caret target (Chrome types
  // before it). Normalise such blocks to a single <br> so the caret sticks.
  const meaningful = (target.textContent ?? "").split(ZWSP).join("").length > 0;
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

// ── Legacy/headless default setup ──────────────────────────────────────────

let cachedDefault: { rules: RuleSet; ctxFor: (root: HTMLElement) => EditorContext } | null = null;

function defaultSetup(): { rules: RuleSet; ctxFor: (root: HTMLElement) => EditorContext } {
  if (cachedDefault) return cachedDefault;
  const registry = resolvePlugins([corePreset()]);
  cachedDefault = {
    rules: { block: registry.blockRules, inline: registry.inlineRules },
    ctxFor: (root: HTMLElement) => ({
      root,
      exec: (cmd: string, payload?: unknown) => { applyCommand(root, cmd, payload); return true; },
      transact: <T,>(fn: () => T) => fn(),
      dom: {
        deleteLeadingChars: (block: HTMLElement, n: number) => deleteLeadingChars(block, n),
      },
    }) as unknown as EditorContext,
  };
  return cachedDefault;
}

export { applyCommand };
