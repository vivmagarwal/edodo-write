/**
 * Emoji — `:shortcode:` ↔ a glyph chip.
 *
 * The stored form is the shortcode itself (`:rocket:`), so the Markdown stays
 * lossless plain text and degrades perfectly in editors without the plugin.
 * The visible node is the glyph, but the paired marked+turndown extension keeps
 * the shortcode on the chip (`data-shortcode`) so it round-trips byte-stable:
 *
 *   parse:      `:rocket:` → `<span class="ew-emoji" data-shortcode="rocket">🚀</span>`
 *   serialize:  that span   → `:rocket:`
 *
 * Grammar: `/:([a-z0-9_+-]+):/i`, looked up lowercased against `map`. An
 * UNKNOWN shortcode is left completely alone — `:nope:` survives verbatim (the
 * tokenizer refuses to consume a code the map doesn't know).
 *
 * `storedForm: "unicode"` serialises the bare glyph instead (no reverse rule
 * needed — the glyph is plain text).
 *
 * The default map is the curated built-in `defaultEmojiMap` (gemoji-standard
 * names); hosts replace or extend it. Typing a completed `:shortcode:` for a
 * KNOWN code converts it to a chip in the live editor (unknown codes never
 * convert, so times like "12:30:45" are safe), and `:` + two or more query
 * characters opens the Slack-style suggestion menu (same trigger machinery as
 * the tags() mention menu: block start or after whitespace, never in code).
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { scrollRowIntoList } from "../core/ui.js";
import { lineTextBeforeCaret, spanBeforeCaret } from "../core/dom.js";
import { escapeAttr } from "./widget.js";
import { defaultEmojiMap } from "./emoji-map.js";

export interface EmojiOptions {
  /**
   * shortcode → glyph. Default: the built-in `defaultEmojiMap` (a curated
   * gemoji-standard set). Replace it wholesale, or extend it:
   * `{ ...defaultEmojiMap, shipit: "🐿️" }`.
   */
  map?: Record<string, string>;
  /** Delimiter character. Default: ":". */
  trigger?: string;
  /**
   * The interactive suggestion menu: typing `:` + two or more characters
   * opens a filtered shortcode list (Slack-style); Enter/Tab/click inserts,
   * Escape dismisses. Default: true.
   */
  autocomplete?: boolean;
  /** Reserved for the browse-all emoji picker panel. Default: true. */
  picker?: boolean;
  /**
   * How the emoji is stored/serialised. Default "shortcode" (`:name:`);
   * "unicode" serialises the bare glyph.
   */
  storedForm?: "shortcode" | "unicode";
  /** Build the chip Node (defaults to `span.ew-emoji`). Used for live typing. */
  render?: (glyph: string, code: string) => Node;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function emoji(options: EmojiOptions = {}): EdodoPlugin {
  const map = options.map ?? defaultEmojiMap;
  const trigger = options.trigger ?? ":";
  const shortcodeStored = (options.storedForm ?? "shortcode") !== "unicode";
  const t = escapeRegExp(trigger);
  // Grammar: `:([a-z0-9_+-]+):` (case-insensitive; lowercased on lookup).
  const codeRe = new RegExp(`^${t}([a-z0-9_+-]+)${t}`, "i");
  const rendered = new WeakSet<Node>();

  const chipHtml = (code: string, glyph: string): string =>
    `<span class="ew-emoji" data-shortcode="${escapeAttr(code)}">${escapeAttr(glyph)}</span>`;

  const chipNode = (code: string, glyph: string): Node => {
    if (options.render) return options.render(glyph, code);
    const span = document.createElement("span");
    span.className = "ew-emoji";
    span.setAttribute("data-shortcode", code);
    span.textContent = glyph;
    return span;
  };

  // Type-to-replace only KNOWN codes — an alternation of the map keys, so an
  // unknown `:foo:` never matches and is never eaten.
  const keys = Object.keys(map);
  const inputRules = keys.length
    ? [{
        kind: "inline" as const,
        trigger: new RegExp(`${t}(${keys.map(escapeRegExp).join("|")})${t}$`, "i"),
        apply: (m: RegExpExecArray): Node => {
          const code = m[1].toLowerCase();
          const glyph = map[code] ?? "";
          return shortcodeStored ? chipNode(code, glyph) : document.createTextNode(glyph);
        },
      }]
    : [];

  // Live-editor pass: honour a custom `render` for stored chips arriving via a
  // setMarkdown parse. Runs OUTSIDE transact — the data-shortcode is preserved,
  // so the serialized value is unchanged (same precedent as the tags decorate).
  const decorate = (ctx: EditorContext): void => {
    if (!options.render || !shortcodeStored) return;
    ctx.root.querySelectorAll<HTMLElement>("span[data-shortcode]").forEach((span) => {
      if (rendered.has(span)) return;
      const code = span.getAttribute("data-shortcode") ?? "";
      const glyph = map[code.toLowerCase()] ?? span.textContent ?? "";
      const node = options.render!(glyph, code);
      rendered.add(node);
      span.replaceWith(node);
    });
  };

  // ── `:query` suggestion menu ──────────────────────────────────────────────
  // Same shape as the tags() mention menu: trigger at a block start or after
  // whitespace, matched against the NBSP-normalized, ZWSP-free text before
  // the caret; two query characters open it (one would fire on every ordinary
  // colon-then-word, e.g. "note:s" while editing).
  const ZWSP = String.fromCharCode(0x200b);
  const autocomplete = options.autocomplete !== false;
  const queryRe = new RegExp(`(^|\\s)${t}([a-z0-9_+-]{2,})$`, "i");

  interface MenuState {
    close(): void;
    list: HTMLElement;
    entries: string[]; // shortcodes
    index: number;
    mouseArmed: boolean;
  }
  let state: MenuState | null = null;

  const matchAtCaret = (ctx: EditorContext): { block: HTMLElement; query: string } | null => {
    const top = ctx.dom.currentBlock();
    if (!top || top.tagName === "PRE") return null; // never inside code blocks
    // LINE-local text (nearest <li>, restarted after <br>) — block-level text
    // concatenates sibling list items with no separator, so the `(^|\s)`
    // guard would see the previous item's last word before the trigger.
    const at = lineTextBeforeCaret(ctx.root);
    if (!at) return null;
    const m = queryRe.exec(at.text);
    return m ? { block: at.line, query: m[2].toLowerCase() } : null;
  };

  /** Prefix matches first (alphabetical), then substring matches; cap 8. */
  const suggestions = (query: string): string[] => {
    const prefix: string[] = [];
    const inner: string[] = [];
    for (const code of Object.keys(map).sort()) {
      if (code.startsWith(query)) prefix.push(code);
      else if (code.includes(query)) inner.push(code);
    }
    return [...prefix, ...inner].slice(0, 8);
  };

  const closeMenu = (): void => {
    state?.close(); // the popover's onClose nulls `state`
  };

  const renderRows = (ctx: EditorContext): void => {
    const menu = state;
    if (!menu) return;
    menu.list.textContent = "";
    menu.entries.forEach((code, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ew-menu__item ew-menu__item--emoji" + (i === menu.index ? " is-active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === menu.index ? "true" : "false");
      const glyph = document.createElement("span");
      glyph.className = "ew-emoji-menu__glyph";
      glyph.textContent = map[code];
      const title = document.createElement("span");
      title.className = "ew-menu__title";
      title.textContent = `${trigger}${code}${trigger}`;
      row.appendChild(glyph);
      row.appendChild(title);
      // Hover highlighting only after the mouse actually moves — the menu may
      // open under the resting pointer.
      row.addEventListener("mousemove", () => {
        if (state !== menu || !menu.mouseArmed) return;
        menu.index = i;
        highlightRows();
      });
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => pick(ctx, code));
      menu.list.appendChild(row);
    });
  };

  const highlightRows = (): void => {
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
    highlightRows();
    return true;
  };

  const openMenu = (ctx: EditorContext, block: HTMLElement): void => {
    const handle = ctx.ui.popover({
      anchor: ctx.dom.selectionRect() ?? block,
      placement: "below",
      render(container) {
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

  const syncMenu = (ctx: EditorContext): void => {
    const at = matchAtCaret(ctx);
    const entries = at ? suggestions(at.query) : [];
    if (!at || entries.length === 0) {
      closeMenu();
      return;
    }
    if (!state) openMenu(ctx, at.block);
    if (!state) return;
    state.entries = entries;
    state.index = 0;
    renderRows(ctx);
  };

  const pick = (ctx: EditorContext, code: string): void => {
    const at = matchAtCaret(ctx);
    closeMenu();
    if (!at) return;
    const glyph = map[code];
    if (glyph === undefined) return;
    ctx.transact(() => {
      const range = spanBeforeCaret(at.block, trigger.length + at.query.length);
      if (!range) return;
      // The caret may sit INSIDE the token (ArrowLeft, then Enter): consume
      // the token tail after the caret too, or the pick strands stray query
      // text right after the chip.
      const end = range.endContainer;
      if (end.nodeType === Node.TEXT_NODE) {
        const data = (end as Text).data;
        let o = range.endOffset;
        while (o < data.length && /[a-z0-9_+-]/i.test(data[o])) o += 1;
        range.setEnd(end, o);
      }
      range.deleteContents();
      if (shortcodeStored) {
        // ZWSP parks the caret OUTSIDE the chip (else the next keystroke
        // lands inside the span and corrupts the shortcode); stripped on
        // serialize like all caret furniture.
        const anchor = document.createTextNode(ZWSP);
        range.insertNode(anchor);
        range.insertNode(chipNode(code, glyph)); // at the range start — before the anchor
        ctx.dom.placeCaretAfter(anchor);
      } else {
        const text = document.createTextNode(glyph);
        range.insertNode(text);
        ctx.dom.placeCaretAfter(text);
      }
    });
  };

  const plugin: EdodoPlugin = {
    name: "emoji",

    inputRules,

    markdown: {
      marked: [{
        extensions: [{
          name: "emoji",
          level: "inline",
          start: (src: string) => src.indexOf(trigger),
          tokenizer(src: string) {
            const m = codeRe.exec(src);
            if (!m) return undefined;
            const code = m[1].toLowerCase();
            const glyph = map[code];
            if (!glyph) return undefined; // unknown shortcode → literal passthrough
            return { type: "emoji", raw: m[0], code, glyph };
          },
          renderer(token) {
            const code = String(token.code);
            const glyph = String(token.glyph);
            return shortcodeStored ? chipHtml(code, glyph) : escapeAttr(glyph);
          },
        }],
      }],
      turndown: shortcodeStored
        ? (td) => {
            td.addRule("emoji", {
              filter: (node) =>
                node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute("data-shortcode"),
              replacement: (_content, node) =>
                `${trigger}${(node as HTMLElement).getAttribute("data-shortcode") ?? ""}${trigger}`,
            });
          }
        : undefined,
    },

    setup: (ctx) => {
      decorate(ctx);
      if (!autocomplete) return;
      const onInput = (e: Event) => {
        // The editor never runs input rules mid-IME-composition; our own
        // input listener must make the same check.
        if ((e as InputEvent).isComposing) return;
        syncMenu(ctx);
      };
      ctx.root.addEventListener("input", onInput);
      return () => {
        ctx.root.removeEventListener("input", onInput);
        closeMenu();
      };
    },

    // Bindings act ONLY while the menu is open — otherwise they return false
    // and fall through to the next binding / the structural engine. Tab picks
    // too (Slack muscle memory).
    // Every binding ignores IME composition keydowns (Firefox/Safari deliver
    // the real key with isComposing=true; consuming it would navigate the menu
    // instead of the IME candidate list, or commit a pick mid-composition).
    keymap: autocomplete
      ? {
          ArrowDown: (_ctx, e) => !e.isComposing && move(1),
          ArrowUp: (_ctx, e) => !e.isComposing && move(-1),
          Enter: (ctx, e) => {
            if (!state || e.isComposing) return false;
            pick(ctx, state.entries[state.index]);
            return true;
          },
          Tab: (ctx, e) => {
            if (!state || e.isComposing) return false;
            pick(ctx, state.entries[state.index]);
            return true;
          },
          Escape: (_ctx, e) => {
            if (!state || e.isComposing) return false;
            closeMenu();
            return true;
          },
        }
      : undefined,

    on: {
      change: (_md, ctx) => decorate(ctx),
      ...(autocomplete
        ? {
            // Caret left the trigger span (click elsewhere, arrow past it,
            // selection left the editor) → close. Still inside it (ArrowLeft
            // within the query) → REFILTER, so the rows always match what a
            // pick would consume.
            selection: (info: unknown, ctx: EditorContext) => {
              if (!state) return;
              if (!info || !matchAtCaret(ctx)) closeMenu();
              else syncMenu(ctx);
            },
            blur: () => closeMenu(),
          }
        : {}),
    },
  };

  if (shortcodeStored) {
    plugin.sanitize = { tags: ["span"], attributes: { span: ["data-shortcode"] } };
  }

  return definePlugin(plugin);
}
