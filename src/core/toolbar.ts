/**
 * The floating selection toolbar (Medium-style). Appears above a non-empty
 * text selection and applies inline/block formatting. It lives on
 * `document.body` (position: absolute) so it is never clipped by the editor's
 * overflow, and it `preventDefault`s its own mousedown so clicking a button
 * never collapses the selection it is about to format.
 */

import type { Command, SelectionInfo } from "./types.js";

interface ToolbarButton {
  cmd: Command;
  label: string;
  title: string;
  activeKey?: keyof SelectionInfo;
}

const BUTTONS: ToolbarButton[] = [
  { cmd: "bold", label: "B", title: "Bold  (⌘B)", activeKey: "bold" },
  { cmd: "italic", label: "I", title: "Italic  (⌘I)", activeKey: "italic" },
  { cmd: "strike", label: "S", title: "Strikethrough", activeKey: "strike" },
  { cmd: "code", label: "</>", title: "Inline code", activeKey: "code" },
  { cmd: "link", label: "🔗", title: "Link  (⌘K)", activeKey: "link" },
  { cmd: "heading1", label: "H1", title: "Heading 1" },
  { cmd: "heading2", label: "H2", title: "Heading 2" },
  { cmd: "blockquote", label: "❝", title: "Quote" },
];

export interface ToolbarDeps {
  exec: (cmd: Command) => void;
  requestLink: () => void;
}

export class SelectionToolbar {
  private el: HTMLElement;
  private buttons = new Map<Command, HTMLButtonElement>();

  constructor(private deps: ToolbarDeps) {
    this.el = document.createElement("div");
    this.el.className = "ew-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.addEventListener("mousedown", (e) => e.preventDefault());

    for (const b of BUTTONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ew-toolbar__btn";
      btn.dataset.cmd = b.cmd;
      btn.textContent = b.label;
      btn.title = b.title;
      btn.setAttribute("aria-label", b.title);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (b.cmd === "link") this.deps.requestLink();
        else this.deps.exec(b.cmd);
      });
      this.buttons.set(b.cmd, btn);
      this.el.appendChild(btn);
    }
    document.body.appendChild(this.el);
  }

  update(info: SelectionInfo | null): void {
    if (!info || info.collapsed || info.empty || !info.rect) {
      this.hide();
      return;
    }
    for (const b of BUTTONS) {
      const btn = this.buttons.get(b.cmd);
      if (!btn) continue;
      const active = b.activeKey ? Boolean(info[b.activeKey]) : false;
      btn.classList.toggle("is-active", active);
    }
    this.show(info.rect);
  }

  private show(rect: DOMRect): void {
    this.el.classList.add("is-visible");
    const { width, height } = this.el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    let left = rect.left + scrollX + rect.width / 2 - width / 2;
    left = Math.max(8 + scrollX, Math.min(left, scrollX + document.documentElement.clientWidth - width - 8));
    const top = rect.top + scrollY - height - 8;
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    this.el.classList.remove("is-visible");
  }

  destroy(): void {
    this.el.remove();
  }
}
