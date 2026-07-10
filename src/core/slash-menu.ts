/**
 * The `/` slash command menu (Notion-style). Typing `/` at the start of an
 * empty paragraph opens a filterable block picker; Arrow keys move, Enter
 * inserts, Escape (or losing the `/query` shape) closes.
 *
 * The editor forwards `input` (→ `sync`) and `keydown` (→ `onKeyDown`) to this
 * object; everything else (positioning, filtering, rendering) is self-managed.
 */

import {
  currentBlock, selectionRect, placeCaretAtStart, deleteLeadingChars,
} from "./dom.js";
import type { Command } from "./types.js";

interface SlashItem {
  title: string;
  cmd: Command;
  hint: string;
  keys: string[];
}

const ITEMS: SlashItem[] = [
  { title: "Text", cmd: "paragraph", hint: "Plain paragraph", keys: ["text", "paragraph", "body"] },
  { title: "Heading 1", cmd: "heading1", hint: "Large section title", keys: ["h1", "heading", "title", "big"] },
  { title: "Heading 2", cmd: "heading2", hint: "Medium heading", keys: ["h2", "heading", "subtitle"] },
  { title: "Heading 3", cmd: "heading3", hint: "Small heading", keys: ["h3", "heading"] },
  { title: "Bulleted list", cmd: "bulletList", hint: "A simple bullet list", keys: ["bullet", "unordered", "ul", "list"] },
  { title: "Numbered list", cmd: "orderedList", hint: "A numbered list", keys: ["number", "ordered", "ol", "list"] },
  { title: "To-do list", cmd: "taskList", hint: "Track tasks with checkboxes", keys: ["todo", "task", "check", "checkbox"] },
  { title: "Quote", cmd: "blockquote", hint: "Capture a quote", keys: ["quote", "blockquote", "cite"] },
  { title: "Code", cmd: "codeBlock", hint: "Fenced code block", keys: ["code", "pre", "fence", "snippet"] },
  { title: "Divider", cmd: "divider", hint: "Visual separator", keys: ["divider", "hr", "rule", "line", "separator"] },
];

export class SlashMenu {
  private el: HTMLElement;
  private list: HTMLElement;
  private open = false;
  private query = "";
  private index = 0;
  private filtered: SlashItem[] = [];
  private anchor: HTMLElement | null = null;

  constructor(private root: HTMLElement, private exec: (cmd: Command) => void) {
    this.el = document.createElement("div");
    this.el.className = "ew-slash";
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
    if (!block || block.tagName !== "P") {
      this.close();
      return;
    }
    const text = block.textContent ?? "";
    const m = /^\/(\S*)$/.exec(text);
    if (!m) {
      this.close();
      return;
    }
    this.anchor = block;
    this.query = m[1].toLowerCase();
    this.openOrUpdate();
  }

  private openOrUpdate(): void {
    this.filtered = this.query
      ? ITEMS.filter((it) => it.title.toLowerCase().includes(this.query) || it.keys.some((k) => k.includes(this.query)))
      : ITEMS;
    if (this.filtered.length === 0) {
      this.close();
      return;
    }
    this.index = 0;
    this.render();
    this.position();
    this.open = true;
    this.el.classList.add("is-visible");
  }

  private render(): void {
    this.list.innerHTML = "";
    this.filtered.forEach((it, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ew-slash__item" + (i === this.index ? " is-active" : "");
      row.setAttribute("role", "option");
      row.innerHTML = `<span class="ew-slash__title">${it.title}</span><span class="ew-slash__hint">${it.hint}</span>`;
      row.addEventListener("mouseenter", () => { this.index = i; this.highlight(); });
      row.addEventListener("click", (e) => { e.preventDefault(); this.choose(it); });
      this.list.appendChild(row);
    });
  }

  private highlight(): void {
    Array.from(this.list.children).forEach((c, i) => c.classList.toggle("is-active", i === this.index));
  }

  private position(): void {
    const rect = selectionRect();
    if (!rect) return;
    const top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;
    const width = 260;
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
    if (!block) return;
    deleteLeadingChars(block, this.query.length + 1); // "/query"
    placeCaretAtStart(block);
    this.exec(item.cmd);
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
