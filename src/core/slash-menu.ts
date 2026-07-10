/**
 * The `/` slash command menu (Notion-style). Typing `/` at the start of an
 * empty paragraph — or an empty list item — opens a filterable block picker;
 * Arrow keys move, Enter/Tab inserts, Escape (or a query with no matches)
 * closes.
 *
 * Items come from the plugin registry (core preset + plugins); this class is
 * only the picker UI. Filtering is word-wise, so multi-word queries like
 * "head 1" keep the menu open and match "Heading 1" — a space no longer kills
 * the menu.
 *
 * The editor forwards `input` (→ `sync`) and `keydown` (→ `onKeyDown`) to this
 * object; everything else (positioning, filtering, rendering) is self-managed.
 */

import { currentBlock, currentListItem, selectionRect, deleteLeadingChars, textBeforeCaret } from "./dom.js";
import { anchorCaret } from "./input-rules.js";
import { guard } from "./plugin.js";
import type { EditorContext, SlashItem } from "./types.js";

const ZWSP = String.fromCharCode(0x200b);

export class SlashMenu {
  private el: HTMLElement;
  private list: HTMLElement;
  private open = false;
  private query = "";
  private index = 0;
  private filtered: SlashItem[] = [];
  private anchor: HTMLElement | null = null;
  private mouseArmed = false;

  constructor(
    private root: HTMLElement,
    private items: SlashItem[],
    private ctx: EditorContext,
  ) {
    this.el = document.createElement("div");
    this.el.className = "ew ew-slash";
    this.el.setAttribute("role", "listbox");
    this.el.addEventListener("mousedown", (e) => e.preventDefault());
    this.list = document.createElement("div");
    this.list.className = "ew-slash__list";
    this.el.appendChild(this.list);
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Called on every `input`; opens/updates/closes based on the caret block. */
  sync(): void {
    const block = currentBlock(this.root);
    const item = currentListItem(this.root);
    const target = item ?? block;
    if (!target || (item ? false : block!.tagName !== "P")) {
      this.close();
      return;
    }
    // Visible text only — a task item's ZWSP caret anchor must not break the
    // "/…" shape.
    const text = (target.textContent ?? "").split(ZWSP).join("");
    const m = /^\/(.*)$/.exec(text);
    if (!m || /\n/.test(m[1])) {
      this.close();
      return;
    }
    this.anchor = target;
    this.query = m[1].toLowerCase();
    this.openOrUpdate();
  }

  private matches(item: SlashItem): boolean {
    if (item.when && !guard("slash", "when", () => item.when!(this.ctx))) return false;
    if (!this.query) return true;
    const haystack = [item.title.toLowerCase(), ...(item.keywords ?? [])];
    // Every word of the query must appear somewhere.
    return this.query.split(/\s+/).filter(Boolean).every(
      (word) => haystack.some((h) => h.includes(word)),
    );
  }

  private openOrUpdate(): void {
    this.filtered = this.items.filter((it) => this.matches(it));
    if (this.filtered.length === 0) {
      this.close();
      return;
    }
    this.index = 0;
    this.mouseArmed = false;
    this.el.addEventListener("mousemove", () => { this.mouseArmed = true; }, { once: true });
    this.render();
    this.position();
    this.open = true;
    this.el.classList.add("is-visible");
  }

  private render(): void {
    this.list.textContent = "";
    let lastGroup: string | undefined;
    this.filtered.forEach((it, i) => {
      const group = it.group ?? "Blocks";
      if (group !== lastGroup) {
        const head = document.createElement("div");
        head.className = "ew-slash__group";
        head.textContent = group;
        this.list.appendChild(head);
        lastGroup = group;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ew-slash__item" + (i === this.index ? " is-active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === this.index ? "true" : "false");
      row.id = `ew-slash-${it.id}`;
      const title = document.createElement("span");
      title.className = "ew-slash__title";
      title.textContent = it.title;
      row.appendChild(title);
      if (it.hint) {
        const hint = document.createElement("span");
        hint.className = "ew-slash__hint";
        hint.textContent = it.hint;
        row.appendChild(hint);
      }
      // Hover highlighting only after the mouse actually MOVES — a menu that
      // opens under the resting pointer must not steal the keyboard highlight.
      row.addEventListener("mouseenter", () => {
        if (!this.mouseArmed) return;
        this.index = i;
        this.highlight();
      });
      row.addEventListener("click", (e) => { e.preventDefault(); this.choose(it); });
      this.list.appendChild(row);
    });
    this.updateActiveDescendant();
  }

  private highlight(): void {
    Array.from(this.list.querySelectorAll(".ew-slash__item")).forEach((c, i) => {
      c.classList.toggle("is-active", i === this.index);
      c.setAttribute("aria-selected", i === this.index ? "true" : "false");
    });
    this.updateActiveDescendant();
    this.list.querySelectorAll(".ew-slash__item")[this.index]
      ?.scrollIntoView({ block: "nearest" });
  }

  private updateActiveDescendant(): void {
    const active = this.filtered[this.index];
    if (active) this.el.setAttribute("aria-activedescendant", `ew-slash-${active.id}`);
  }

  private position(): void {
    const rect = selectionRect();
    if (!rect) return;
    const top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;
    const width = 280;
    left = Math.min(left, window.scrollX + document.documentElement.clientWidth - width - 8);
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  /** Returns true when the keydown was consumed by the open menu. */
  onKeyDown(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.index = (this.index + 1) % this.filtered.length;
      this.highlight();
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.index = (this.index - 1 + this.filtered.length) % this.filtered.length;
      this.highlight();
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.choose(this.filtered[this.index]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return true;
    }
    return false;
  }

  private choose(item: SlashItem): void {
    const block = this.anchor;
    this.close();
    if (!block || !item) return;
    // Remove the whole "/query" trigger — counted in RAW characters (the
    // query was matched on ZWSP-stripped text, but deletion walks real DOM
    // text nodes; a leading ZWSP anchor must be counted, a checkbox is
    // protected by deleteLeadingChars' first-text-node anchoring).
    const raw = block.textContent ?? "";
    deleteLeadingChars(block, raw.length);
    anchorCaret(block);
    if (item.command) {
      this.ctx.exec(item.command as string, item.payload);
    } else if (item.run) {
      guard("slash", `item "${item.id}"`, () => item.run!(this.ctx));
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove("is-visible");
  }

  destroy(): void {
    this.el.remove();
  }
}
