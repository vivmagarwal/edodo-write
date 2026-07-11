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

import type { MarkedExtension } from "marked";
import type TurndownService from "turndown";
import { scrollRowIntoList } from "../core/ui.js";
import { lineTextBeforeCaret, spanBeforeCaret } from "../core/dom.js";
import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import type { MarkdownExtensionSpec } from "../core/types.js";
import { escapeAttr } from "./widget.js";

export interface TagItem {
  label: string;
  href?: string;
  hint?: string;
  id?: string;
  /** Frozen display name for the custom-token (mention) seam. */
  display?: string;
  /** Optional metadata a host may attach for its own suggestion rows. */
  subtitle?: string;
  avatar?: string;
  color?: string;
}

/**
 * The item shape the custom-token (mention) seam works with — id + a frozen
 * display name. This is what `parse.toItem` produces and what `serialize` /
 * `render` receive (RFC §5.3).
 */
export interface TagTokenItem {
  id: string;
  display: string;
  subtitle?: string;
  avatar?: string;
  color?: string;
}

/**
 * Relabel a stored mention at render time WITHOUT touching the stored token —
 * e.g. a deleted account shows "Deleted user" while the markdown still carries
 * the original frozen display. Return `null` to keep the frozen display.
 */
export type ResolveMention = (id: string, fallbackDisplay: string) => { display: string } | null;

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

  // ── Custom-token (mention) seam (RFC §5) ───────────────────────────────────
  // Supply BOTH `serialize` and `parse` to store a CUSTOM token (e.g. EDodo's
  // `@[Display](id)`) instead of a plain GFM link. When present the plugin
  // registers the paired marked tokenizer + turndown rule + sanitizer
  // allowances so the token round-trips byte-stable. Omit them for exactly the
  // GFM behaviour this plugin has always had (fully backward compatible).

  /** The broadcast item (e.g. `{ id:"@channel", display:"channel" }`). */
  allowBroadcast?: { id: string; display: string };
  /** `TagTokenItem` → the stored markdown token (NO trailing space; the engine adds it). */
  serialize?: (item: TagTokenItem) => string;
  /** The token grammar the marked tokenizer + host extractors share. */
  parse?: {
    /** e.g. `/@\[([^\]]+)\]\(([^)\s]+)\)/g`. */
    pattern: RegExp;
    /** capture groups → `{ id, display }`. */
    toItem: (m: RegExpExecArray) => TagTokenItem;
  };
  /** Build the read-render chip Node (defaults to a `span.ew-mention`). */
  render?: (item: TagTokenItem, resolve?: ResolveMention) => Node;
  /** Relabel a stored mention at render time (deleted-account relabel). */
  resolveMention?: ResolveMention;
}

const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);

interface Entry {
  label: string;
  href: string | null;
  hint?: string;
  create?: boolean;
  /** Present only in TOKEN MODE — the item picking this entry stores as a
   *  custom `@[Display](id)` token (via `buildMentionChipNode` → `serialize`). */
  token?: TagTokenItem;
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
    const top = ctx.dom.currentBlock();
    if (!top || top.tagName === "PRE") return null; // never inside code blocks
    // LINE-local text (nearest <li>, restarted after <br>) — block-level text
    // concatenates sibling list items with no separator, so the `(^|\s)`
    // guard would see the previous item's last word before the trigger.
    const at = lineTextBeforeCaret(ctx.root);
    if (!at) return null;
    const m = triggerRe.exec(at.text);
    return m ? { block: at.line, query: m[2] } : null;
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
    scrollRowIntoList(menu.list, rows[menu.index] as HTMLElement | undefined);
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
    const entries: Entry[] = [];
    // TOKEN MODE only: a synthetic broadcast entry (e.g. `@channel`) leads the
    // menu for an empty or prefix-matching query, so picking it stores the
    // broadcast token exactly like any other mention.
    if (tokenMode && options.allowBroadcast) {
      const b = options.allowBroadcast;
      if (query === "" || b.display.toLowerCase().startsWith(query.toLowerCase())) {
        entries.push({ label: b.display, href: null, token: { id: b.id, display: b.display } });
      }
    }
    for (const it of items) {
      entries.push({
        label: it.label,
        hint: it.hint,
        href: resolveHref(it),
        // In token mode, carry the id/display so `pick()` inserts a chip that
        // `serialize()` turns into exactly `serialize(item)`.
        token: tokenMode ? { id: it.id ?? "", display: it.display ?? it.label } : undefined,
      });
    }
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
      // The caret may sit INSIDE the token (ArrowLeft, then Enter): consume
      // the token tail after the caret too, or the pick strands stray query
      // text right after the chip.
      const end = range.endContainer;
      if (end.nodeType === Node.TEXT_NODE) {
        const data = (end as Text).data;
        let o = range.endOffset;
        while (o < data.length && /[\w-]/.test(data[o])) o += 1;
        range.setEnd(end, o);
      }
      range.deleteContents();
      // Trailing typed spaces reach the DOM as NBSP; inserting the same form
      // keeps the caret placeable after the chip. The serializer's tidy pass
      // writes it back as a plain space.
      const space = document.createTextNode(NBSP);
      // TOKEN MODE: a picked item with a token becomes a mention chip whose
      // serialize() yields exactly `serialize(item)` — the same chip the
      // stored-token decorate path builds. Otherwise the historical GFM
      // behaviour is byte-identical: linked → chip anchor, else plain text.
      const node: Node =
        tokenMode && entry.token
          ? buildMentionChipNode(entry.token)
          : entry.href
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
    // Multiple instances (# tags + @ mentions) each decorate the SAME link
    // set — adopt matching links and release only links THIS instance owns,
    // never blanket-toggle (that would strip a sibling instance's chips).
    ctx.root.querySelectorAll("a").forEach((a) => {
      const text = a.textContent ?? "";
      if (text.startsWith(trigger)) {
        a.classList.add("ew-tag");
        a.dataset.tagTrigger = trigger;
      } else if (a.dataset.tagTrigger === trigger) {
        a.classList.remove("ew-tag");
        delete a.dataset.tagTrigger;
      }
    });
  };

  // ── Custom-token (mention) seam ─────────────────────────────────────────────
  // Active only when BOTH serialize and parse are supplied. It registers the
  // paired marked tokenizer + turndown rule so a host's custom token (e.g.
  // `@[Display](id)`) round-trips byte-stable, and decorates stored chips in
  // the live editor. When absent, everything below is inert and the plugin is
  // exactly its historical GFM-link self.
  const tokenMode = !!(options.serialize && options.parse);
  const extName = `mention_${options.name ?? "tags"}`;
  const rendered = new WeakSet<Node>();

  const buildMentionMarkdown = (): MarkdownExtensionSpec => {
    const parseCfg = options.parse!;
    const flags = parseCfg.pattern.flags.replace(/[gy]/g, "");
    // Wrap in a non-capturing group so a top-level alternation in the host's
    // pattern isn't broken by the `^` anchor; inner capture indices survive.
    const anchored = new RegExp(`^(?:${parseCfg.pattern.source})`, flags);
    const search = new RegExp(parseCfg.pattern.source, flags);
    const marked: MarkedExtension[] = [{
      extensions: [{
        name: extName,
        level: "inline",
        start(src: string) {
          const idx = src.search(search);
          return idx < 0 ? undefined : idx;
        },
        tokenizer(src: string) {
          const m = anchored.exec(src);
          if (!m) return undefined;
          return { type: extName, raw: m[0], item: parseCfg.toItem(m) };
        },
        renderer(token) {
          return mentionChipHtml(token.item as TagTokenItem);
        },
      }],
    }];
    return {
      marked,
      turndown: (td: TurndownService) => {
        td.addRule(extName, {
          filter: (node) =>
            node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute("data-mention-id"),
          replacement: (_content, node) => {
            const el = node as HTMLElement;
            return options.serialize!({
              id: el.getAttribute("data-mention-id") ?? "",
              display: el.getAttribute("data-mention-display") ?? "",
            });
          },
        });
      },
    };
  };

  const mentionChipHtml = (item: TagTokenItem): string => {
    const id = String(item.id ?? "");
    const display = String(item.display ?? "");
    const shown = options.resolveMention?.(id, display)?.display ?? display;
    return (
      `<span class="ew-mention" data-mention-id="${escapeAttr(id)}"` +
      ` data-mention-display="${escapeAttr(display)}" contenteditable="false">` +
      `${escapeAttr(trigger + shown)}</span>`
    );
  };

  /**
   * Build the read-render chip Node for a token item. The single builder shared
   * by BOTH the stored-token decorate path AND the interactive menu-pick, so a
   * newly-picked mention is byte-identical to a loaded one:
   *   • with `options.render` → the host's node (added to `rendered`);
   *   • else a default `span.ew-mention[data-mention-id][data-mention-display]
   *     [contenteditable=false]` whose text is trigger + (resolved) display.
   * The `data-mention-*` attributes are exactly what `serialize()`'s turndown
   * rule reads, so `serialize(chip) === serialize(item)`.
   */
  const buildMentionChipNode = (item: TagTokenItem): Node => {
    if (options.render) {
      const node = options.render(item, options.resolveMention);
      rendered.add(node);
      return node;
    }
    const span = document.createElement("span");
    span.className = "ew-mention";
    span.setAttribute("data-mention-id", item.id);
    span.setAttribute("data-mention-display", item.display);
    span.setAttribute("contenteditable", "false");
    const shown = options.resolveMention?.(item.id, item.display)?.display ?? item.display;
    span.textContent = trigger + shown;
    rendered.add(span);
    return span;
  };

  // Live-editor pass: adopt any stored mention chip (from a setMarkdown parse).
  // Runs OUTSIDE transact — same precedent as `decorate`: it never changes the
  // serialized value (data attrs are preserved), only the visible surface.
  const decorateMentions = (ctx: EditorContext): void => {
    ctx.root.querySelectorAll<HTMLElement>("span[data-mention-id]").forEach((span) => {
      if (rendered.has(span)) return;
      const id = span.getAttribute("data-mention-id") ?? "";
      const display = span.getAttribute("data-mention-display") ?? "";
      if (options.render) {
        span.replaceWith(buildMentionChipNode({ id, display }));
      } else {
        span.classList.add("ew-mention");
        span.setAttribute("contenteditable", "false");
        const shown = options.resolveMention?.(id, display)?.display ?? display;
        span.textContent = trigger + shown;
        rendered.add(span);
      }
    });
  };

  const mention = tokenMode ? buildMentionMarkdown() : null;

  const plugin: EdodoPlugin = {
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
      if (tokenMode) decorateMentions(ctx);
      return () => {
        ctx.root.removeEventListener("input", onInput);
        closeMenu();
      };
    },

    // Bindings act ONLY while the menu is open — otherwise they return false
    // and fall through to the next binding / the structural engine. Every
    // binding ignores IME composition keydowns (Firefox/Safari deliver the
    // real key with isComposing=true; consuming it would navigate the menu
    // instead of the IME candidate list, or commit a pick mid-composition).
    keymap: {
      ArrowDown: (_ctx, e) => !e.isComposing && move(1),
      ArrowUp: (_ctx, e) => !e.isComposing && move(-1),
      Enter: (ctx, e) => {
        if (!state || e.isComposing) return false;
        pick(ctx, state.entries[state.index]);
        return true;
      },
      Escape: (_ctx, e) => {
        if (!state || e.isComposing) return false;
        closeMenu();
        return true;
      },
    },

    on: {
      change: (_md, ctx) => {
        decorate(ctx);
        if (tokenMode) decorateMentions(ctx);
      },
      // Caret left the trigger span (click elsewhere, arrow-left past the
      // trigger, selection left the editor) → close. Still inside it
      // (ArrowLeft within the query) → REFILTER, so the rows always match
      // what a pick would consume.
      selection: (info, ctx) => {
        if (!state) return;
        if (!info || !matchAtCaret(ctx)) closeMenu();
        else syncMenu(ctx);
      },
      blur: () => closeMenu(),
    },
  };

  if (mention) {
    plugin.markdown = mention;
    plugin.sanitize = {
      tags: ["span"],
      attributes: { span: ["data-mention-id", "data-mention-display", "contenteditable"] },
    };
  }

  return definePlugin(plugin);
}

function tagChip(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "ew-tag";
  a.setAttribute("href", href);
  a.textContent = text;
  return a;
}

