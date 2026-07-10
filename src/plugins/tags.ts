/**
 * Tags — a source-configurable tagging/mention system (`#tag`, `@user`, …).
 *
 * The Markdown form is pure GFM — zero new syntax, so no marked/turndown work
 * and perfect degradation in editors without the plugin:
 *
 *   • an item WITH an href (its own, or derived via `options.href`) is a
 *     standard link whose text is trigger+label:
 *     `[#alpha](https://example.com/tags/alpha)` — links stay links;
 *   • an item WITHOUT one is plain text: `#gamma` — text stays text.
 *
 * In the editor, any `<a>` whose text starts with the trigger is decorated
 * with the `ew-tag` chip class — visual furniture only, never serialized.
 *
 * Typing the trigger (mid-line or at a block start, never inside code blocks)
 * opens a suggestion menu fed by `options.source` (sync or async; stale async
 * results are discarded by sequence number). Arrow keys navigate, Enter/click
 * picks, Escape closes; with `allowCreate` a non-matching query offers
 * "Create #query".
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";

export interface TagItem {
  label: string;
  href?: string;
  hint?: string;
  id?: string;
}

export interface TagsOptions {
  /** Trigger character. Default: "#". */
  trigger?: string;
  /** The suggestion source — sync or async, called with the typed query. */
  source: (query: string) => TagItem[] | Promise<TagItem[]>;
  /** Derive an href for items without one (return null for plain-text tags). */
  href?: (item: TagItem) => string | null;
  /** Offer "Create #query" when nothing matches. Default: true. */
  allowCreate?: boolean;
  /**
   * Plugin instance name. Default: "tags". Give each instance a distinct
   * name to run several together (e.g. "#" tags plus "@" mentions).
   */
  name?: string;
}

const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);

interface Entry {
  label: string;
  href: string | null;
  hint?: string;
  create?: boolean;
}

interface MenuState {
  close(): void;
  list: HTMLElement;
  entries: Entry[];
  index: number;
  mouseArmed: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tags(options: TagsOptions): EdodoPlugin {
  const trigger = options.trigger ?? "#";
  const allowCreate = options.allowCreate ?? true;
  // Trigger at a block start or after whitespace, query = word chars/hyphens
  // up to the caret. Runs against ctx.dom.textBeforeCaret, which is already
  // NBSP-normalized and ZWSP-free.
  const triggerRe = new RegExp(`(^|\\s)${escapeRegExp(trigger)}([\\w-]*)$`);

  let state: MenuState | null = null;
  let seq = 0; // async-source ticket: stale resolutions are discarded

  const resolveHref = (item: TagItem): string | null =>
    item.href ?? (options.href ? options.href(item) : null);

  const matchAtCaret = (ctx: EditorContext): { block: HTMLElement; query: string } | null => {
    const block = ctx.dom.currentBlock();
    if (!block || block.tagName === "PRE") return null; // never inside code blocks
    const m = triggerRe.exec(ctx.dom.textBeforeCaret(block));
    return m ? { block, query: m[2] } : null;
  };

  const closeMenu = (): void => {
    seq += 1; // an in-flight source() result must not reopen a dismissed menu
    state?.close(); // the popover's onClose nulls `state`
  };

  const highlight = (): void => {
    const menu = state;
    if (!menu) return;
    const rows = menu.list.querySelectorAll(".ew-menu__item");
    rows.forEach((row, i) => {
      row.classList.toggle("is-active", i === menu.index);
      row.setAttribute("aria-selected", i === menu.index ? "true" : "false");
    });
    rows[menu.index]?.scrollIntoView?.({ block: "nearest" });
  };

  const move = (delta: number): boolean => {
    const menu = state;
    if (!menu || menu.entries.length === 0) return false;
    menu.index = (menu.index + delta + menu.entries.length) % menu.entries.length;
    highlight();
    return true;
  };

  const renderRows = (ctx: EditorContext): void => {
    const menu = state;
    if (!menu) return;
    menu.list.textContent = "";
    menu.entries.forEach((entry, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ew-menu__item" + (i === menu.index ? " is-active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === menu.index ? "true" : "false");
      const title = document.createElement("span");
      title.className = "ew-menu__title";
      // Labels are user strings — textContent only, never innerHTML.
      title.textContent = entry.create ? `Create ${trigger}${entry.label}` : `${trigger}${entry.label}`;
      row.appendChild(title);
      if (entry.hint) {
        const hint = document.createElement("span");
        hint.className = "ew-menu__hint";
        hint.textContent = entry.hint;
        row.appendChild(hint);
      }
      // Hover highlighting only after the mouse actually moves — the menu may
      // open under the resting pointer.
      row.addEventListener("mouseenter", () => {
        if (state !== menu || !menu.mouseArmed) return;
        menu.index = i;
        highlight();
      });
      row.addEventListener("click", (e) => {
        e.preventDefault();
        pick(ctx, entry);
      });
      menu.list.appendChild(row);
    });
  };

  const openMenu = (ctx: EditorContext, block: HTMLElement): void => {
    const handle = ctx.ui.popover({
      anchor: ctx.dom.selectionRect() ?? block,
      placement: "below",
      render(container) {
        // The popover container doubles as the list — the .ew-menu family
        // provides the styling (see styles.css: "Tag suggestion menu").
        container.classList.add("ew-menu");
        container.setAttribute("role", "listbox");
        container.addEventListener(
          "mousemove",
          () => { if (state) state.mouseArmed = true; },
          { once: true },
        );
      },
      onClose: () => { state = null; },
    });
    state = { close: handle.close, list: handle.el, entries: [], index: 0, mouseArmed: false };
  };

  const showMenu = (ctx: EditorContext, query: string, block: HTMLElement, items: TagItem[]): void => {
    const entries: Entry[] = items.map((it) => ({
      label: it.label,
      hint: it.hint,
      href: resolveHref(it),
    }));
    if (allowCreate && query && entries.length === 0) {
      entries.push({ label: query, href: resolveHref({ label: query }), create: true });
    }
    if (entries.length === 0) {
      closeMenu();
      return;
    }
    if (!state) openMenu(ctx, block);
    if (!state) return;
    state.entries = entries;
    state.index = 0;
    renderRows(ctx);
  };

  /** Re-query the source and open/update/close the menu for the caret state. */
  const syncMenu = (ctx: EditorContext): void => {
    const at = matchAtCaret(ctx);
    if (!at) {
      closeMenu();
      return;
    }
    const ticket = ++seq;
    const result = options.source(at.query);
    if (Array.isArray(result)) {
      showMenu(ctx, at.query, at.block, result);
      return;
    }
    void Promise.resolve(result).then(
      (items) => { if (ticket === seq) showMenu(ctx, at.query, at.block, items ?? []); },
      () => { if (ticket === seq) closeMenu(); },
    );
  };

  const pick = (ctx: EditorContext, entry: Entry | undefined): void => {
    const at = matchAtCaret(ctx);
    closeMenu();
    if (!at || !entry) return;
    const span = trigger.length + at.query.length;
    ctx.transact(() => {
      const range = spanBeforeCaret(at.block, span);
      if (!range) return;
      range.deleteContents();
      // Trailing typed spaces reach the DOM as NBSP; inserting the same form
      // keeps the caret placeable after the chip. The serializer's tidy pass
      // writes it back as a plain space.
      const space = document.createTextNode(NBSP);
      const node: Node = entry.href
        ? tagChip(entry.href, trigger + entry.label)
        : document.createTextNode(trigger + entry.label);
      range.insertNode(space);
      range.insertNode(node); // inserts at the range start — before the space
      ctx.dom.placeCaretAfter(space);
    });
  };

  /**
   * Chip styling for every link whose text starts with the trigger. The class
   * never reaches the Markdown, so this runs deliberately OUTSIDE transact —
   * a transact here would re-emit `change` (whose handler decorates…) even
   * though the document value is unchanged. Same precedent as the widget
   * machinery's render pass.
   */
  const decorate = (ctx: EditorContext): void => {
    ctx.root.querySelectorAll("a").forEach((a) => {
      a.classList.toggle("ew-tag", (a.textContent ?? "").startsWith(trigger));
    });
  };

  return definePlugin({
    name: options.name ?? "tags",

    setup(ctx) {
      const onInput = (e: Event) => {
        // The editor never runs input rules mid-IME-composition; our own
        // input listener must make the same check.
        if ((e as InputEvent).isComposing) return;
        syncMenu(ctx);
      };
      ctx.root.addEventListener("input", onInput);
      decorate(ctx);
      return () => {
        ctx.root.removeEventListener("input", onInput);
        closeMenu();
      };
    },

    // Bindings act ONLY while the menu is open — otherwise they return false
    // and fall through to the next binding / the structural engine.
    keymap: {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Enter: (ctx) => {
        if (!state) return false;
        pick(ctx, state.entries[state.index]);
        return true;
      },
      Escape: () => {
        if (!state) return false;
        closeMenu();
        return true;
      },
    },

    on: {
      change: (_md, ctx) => decorate(ctx),
      // Caret left the trigger span (click elsewhere, arrow-left past the
      // trigger, selection left the editor) → close.
      selection: (info, ctx) => {
        if (state && (!info || !matchAtCaret(ctx))) closeMenu();
      },
      blur: () => closeMenu(),
    },
  });
}

function tagChip(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "ew-tag";
  a.setAttribute("href", href);
  a.textContent = text;
  return a;
}

/**
 * The range covering the last `count` visible characters before the caret.
 * This is the MID-LINE sibling of `deleteLeadingChars` (which anchors forward
 * from the block start): it walks BACKWARD from the caret across text nodes,
 * skipping ZWSP caret furniture so the count matches the normalized text the
 * trigger regex ran against.
 */
function spanBeforeCaret(block: HTMLElement, count: number): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const caret = sel.getRangeAt(0);
  if (!caret.collapsed || !block.contains(caret.startContainer)) return null;
  // The span is contiguously typed text, so the caret sits in a text node;
  // anything else means the document changed under us — refuse, don't guess.
  if (caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let t: Node | null;
  while ((t = walker.nextNode())) texts.push(t as Text);
  let node = caret.startContainer as Text;
  let offset = caret.startOffset;
  let remaining = count;
  for (;;) {
    const data = node.data;
    while (offset > 0 && remaining > 0) {
      offset -= 1;
      if (data[offset] !== ZWSP) remaining -= 1;
    }
    if (remaining === 0) break;
    const prev = texts.indexOf(node) - 1;
    if (prev < 0) return null;
    node = texts[prev];
    offset = node.data.length;
  }
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(caret.startContainer, caret.startOffset);
  return range;
}
