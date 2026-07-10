/**
 * Built-in formatting commands. All transforms funnel through the command
 * registry; `applyCommand` remains as the stable functional entry point
 * (toolbar, slash-menu, keymap, input rules and `editor.exec()` all reach the
 * same implementations).
 *
 * Inline marks (bold/italic/strike) use `document.execCommand` — deprecated but
 * consistent across browsers. Block transforms are hand-rolled DOM:
 * `execCommand('formatBlock' | 'insertUnorderedList' | …)` is silently dropped
 * by Chrome when called synchronously inside an `input` event (exactly where
 * the Markdown input-rules run), so we never rely on it for structure. Manual
 * DOM also gives predictable, testable output.
 *
 * NOTE for maintainers: the caret placements sprinkled through these bodies
 * (`placeCaretAtEnd` after `setBlock`, the ZWSP anchor in `toggleCodeBlock`,…)
 * look redundant and are not — each one fixes a "typing lands in the wrong
 * block" bug. Move, don't improve.
 */

import type { AnyCommand, CommandSpec, EditorContext } from "./types.js";
import {
  getRange, getSelection, currentBlock, closestWithin, blockKindOf,
  createElement, placeCaretAtEnd, placeCaretAtStart, ensureNotEmpty,
} from "./dom.js";

const ZWSP = String.fromCharCode(0x200b);

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
  placeCaretAtStart(p);
}

function toggleCodeBlock(root: HTMLElement): void {
  const block = currentBlock(root);
  if (!block) return;
  if (block.tagName === "PRE") {
    const p = createElement("p");
    p.textContent = (block.textContent || "").split(ZWSP).join("");
    if (!p.textContent) p.innerHTML = "<br>";
    block.replaceWith(p);
    placeCaretAtEnd(p);
    return;
  }
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.textContent || "";
  // An empty <code> is not a placeable caret, and a <br> inside <pre> would
  // mean a newline — anchor with a zero-width text node (stripped on
  // serialize) so the first typed character lands INSIDE the code block.
  if (!code.textContent) code.appendChild(document.createTextNode(ZWSP));
  pre.appendChild(code);
  block.replaceWith(pre);
  placeCaretAtEnd(code);
}

/** Insert a GFM-shaped table (thead>th header row + tbody rows) after the
 *  current block; caret lands in the first header cell. */
function insertTable(root: HTMLElement, payload?: { rows?: number; cols?: number }): void {
  const rows = Math.max(1, Math.min(payload?.rows ?? 3, 50));
  const cols = Math.max(1, Math.min(payload?.cols ?? 3, 12));
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (let c = 0; c < cols; c++) {
    const th = document.createElement("th");
    th.appendChild(document.createElement("br"));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (let r = 0; r < rows - 1; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < cols; c++) {
      const td = document.createElement("td");
      td.appendChild(document.createElement("br"));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const block = currentBlock(root) || (root.lastElementChild as HTMLElement | null);
  const after = createElement("p", {}, "<br>");
  if (block) {
    block.after(table);
    table.after(after);
    if (block.tagName === "P" && (block.textContent ?? "").split(ZWSP).join("").trim() === "" &&
        !block.querySelector("img,input,hr")) {
      block.remove();
    }
  } else {
    root.append(table, after);
  }
  const firstCell = table.querySelector("th, td") as HTMLElement | null;
  if (firstCell) placeCaretAtStart(firstCell);
}

function insertImage(root: HTMLElement, payload: { src: string; alt?: string }): void {
  if (!payload?.src) return;
  const block = currentBlock(root) || (root.lastElementChild as HTMLElement | null);
  const p = document.createElement("p");
  const img = createElement("img", { src: payload.src, alt: payload.alt ?? "" });
  p.appendChild(img);
  const after = createElement("p", {}, "<br>");
  if (block) {
    block.after(p);
    p.after(after);
    if ((block.textContent ?? "").split(ZWSP).join("").trim() === "" && block.tagName === "P") block.remove();
  } else {
    root.append(p, after);
  }
  placeCaretAtStart(after);
}

// ── Inline transforms ─────────────────────────────────────────────────────

/** Toggle an inline wrapper tag at the selection (the generalized machinery
 *  behind inline code — exposed to plugins via `ctx.dom.toggleInlineTag`). */
export function toggleInlineTag(root: HTMLElement, tag: string): void {
  const upper = tag.toUpperCase();
  const range = getRange();
  if (!range) return;
  const existing = closestWithin(range.startContainer, root, (el) => el.tagName === upper);
  if (existing) {
    unwrap(existing);
    return;
  }
  if (range.collapsed) return;
  wrapRange(range, tag);
}

export function isInlineTagActive(root: HTMLElement, tag: string): boolean {
  const upper = tag.toUpperCase();
  const range = getRange();
  if (!range) return false;
  return !!closestWithin(range.startContainer, root, (el) => el.tagName === upper);
}

function applyLink(root: HTMLElement, href?: string | null): void {
  const range = getRange();
  if (!range) return;
  const existing = closestWithin(range.startContainer, root, (el) => el.tagName === "A");
  if (href == null || href === "") {
    if (existing) {
      // execCommand("unlink") silently no-ops on a collapsed caret — the
      // link must be selected first.
      const sel = getSelection();
      if (sel) {
        const r = document.createRange();
        r.selectNodeContents(existing);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      document.execCommand("unlink");
    }
    return;
  }
  if (existing) {
    // Editing an existing link updates it in place (createLink would no-op
    // on a collapsed caret and split the link on a partial selection).
    existing.setAttribute("href", href);
    return;
  }
  if (range.collapsed) {
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

function safeState(cmd: string): boolean {
  try { return document.queryCommandState(cmd); } catch { return false; }
}

// ── The command specs ──────────────────────────────────────────────────────

function blockSpec(tag: string, kind: string): CommandSpec<void> {
  return {
    run: (ctx) => setBlock(ctx.root, tag),
    isActive: (ctx) => blockKindOf(currentBlock(ctx.root)) === kind,
  };
}

/** The built-in command implementations, keyed by command name. */
export const coreCommands: Record<string, CommandSpec<any>> = {
  bold: { run: () => { document.execCommand("bold"); }, isActive: () => safeState("bold") },
  italic: { run: () => { document.execCommand("italic"); }, isActive: () => safeState("italic") },
  strike: { run: () => { document.execCommand("strikeThrough"); }, isActive: () => safeState("strikeThrough") },
  code: {
    run: (ctx) => toggleInlineTag(ctx.root, "code"),
    isActive: (ctx) => isInlineTagActive(ctx.root, "code"),
  },
  link: {
    run: (ctx, payload: { href: string | null }) => applyLink(ctx.root, payload?.href),
    isActive: (ctx) => isInlineTagActive(ctx.root, "a"),
  },
  clear: { run: (ctx) => clearFormatting(ctx.root) },
  paragraph: blockSpec("P", "paragraph"),
  heading1: blockSpec("H1", "heading1"),
  heading2: blockSpec("H2", "heading2"),
  heading3: blockSpec("H3", "heading3"),
  heading4: blockSpec("H4", "heading4"),
  heading5: blockSpec("H5", "heading5"),
  heading6: blockSpec("H6", "heading6"),
  bulletList: {
    run: (ctx) => toList(ctx.root, { ordered: false }),
    isActive: (ctx) => blockKindOf(currentBlock(ctx.root)) === "bulletList",
  },
  orderedList: {
    run: (ctx) => toList(ctx.root, { ordered: true }),
    isActive: (ctx) => blockKindOf(currentBlock(ctx.root)) === "orderedList",
  },
  taskList: {
    run: (ctx) => toList(ctx.root, { ordered: false, task: true }),
    isActive: (ctx) => blockKindOf(currentBlock(ctx.root)) === "taskList",
  },
  blockquote: {
    run: (ctx) => toggleBlockquote(ctx.root),
    isActive: (ctx) => blockKindOf(currentBlock(ctx.root)) === "blockquote",
  },
  codeBlock: {
    run: (ctx) => toggleCodeBlock(ctx.root),
    isActive: (ctx) => blockKindOf(currentBlock(ctx.root)) === "codeBlock",
  },
  divider: { run: (ctx) => insertDivider(ctx.root) },
  image: { run: (ctx, payload: { src: string; alt?: string }) => insertImage(ctx.root, payload) },
  table: {
    run: (ctx, payload?: { rows?: number; cols?: number }) => insertTable(ctx.root, payload),
    isActive: (ctx) => currentBlock(ctx.root)?.tagName === "TABLE",
  },
};

// ── Stable functional entry points (public API + tests) ────────────────────

/** A minimal context for standalone use — only `root` is populated, which is
 *  all the core command bodies touch. */
function bareContext(root: HTMLElement): EditorContext {
  return { root } as unknown as EditorContext;
}

/** Apply a BUILT-IN command to the given root. The registry-free entry point
 *  used by tests and headless callers; `editor.exec()` goes through the
 *  editor's full registry instead. */
export function applyCommand(root: HTMLElement, cmd: AnyCommand, payload?: unknown): void {
  root.focus();
  const spec = coreCommands[cmd];
  if (!spec) return;
  spec.run(bareContext(root), payload);
}

/** True when the given inline mark is active at the current selection. */
export function isInlineActive(root: HTMLElement, kind: "bold" | "italic" | "strike" | "code" | "link"): boolean {
  const spec = coreCommands[kind];
  return spec?.isActive ? spec.isActive(bareContext(root)) : false;
}
