/**
 * The floating selection toolbar (Medium-style). Appears above a non-empty
 * text selection and applies inline/block formatting. It lives on
 * `document.body` (position: absolute) so it is never clipped by the editor's
 * overflow, and it `preventDefault`s its own mousedown so clicking a button
 * never collapses the selection it is about to format.
 *
 * Buttons come from the plugin registry (core preset + plugins). Active state
 * is resolved per item: an explicit `isActive`, else the item's command's
 * `isActive` via `SelectionInfo.marks`.
 */

import type { EditorContext, SelectionInfo, ToolbarItem } from "./types.js";
import { guard } from "./plugin.js";

export class SelectionToolbar {
  private el: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();

  constructor(private items: ToolbarItem[], private ctx: EditorContext) {
    this.el = document.createElement("div");
    this.el.className = "ew ew-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.addEventListener("mousedown", (e) => e.preventDefault());

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ew-toolbar__btn";
      btn.dataset.cmd = item.id;
      btn.textContent = item.label;
      btn.title = item.title;
      btn.setAttribute("aria-label", item.title);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        guard("toolbar", `item "${item.id}"`, () => {
          if (item.run) item.run(this.ctx);
          else if (item.command) this.ctx.exec(item.command as string, item.payload);
        });
      });
      this.buttons.set(item.id, btn);
      this.el.appendChild(btn);
    }
    document.body.appendChild(this.el);
  }

  update(info: SelectionInfo | null): void {
    if (!info || info.collapsed || info.empty || !info.rect) {
      this.hide();
      return;
    }
    for (const item of this.items) {
      const btn = this.buttons.get(item.id);
      if (!btn) continue;
      const active = item.isActive
        ? !!guard("toolbar", `isActive "${item.id}"`, () => item.isActive!(info, this.ctx))
        : !!(item.command && info.marks[item.command]);
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
