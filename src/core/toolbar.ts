/**
 * The two formatting toolbars.
 *
 * `SelectionToolbar` (floating, Medium-style) appears above a non-empty text
 * selection. It lives on `document.body` (position: absolute) so it is never
 * clipped by the editor's overflow, and it `preventDefault`s its own mousedown
 * so clicking a button never collapses the selection it is about to format.
 *
 * `FixedToolbar` (docked, Slack-style) is a persistent bar above the content
 * that reflects the caret's formatting state even when nothing is selected —
 * the discoverable mode for embedded composers and non-Markdown users.
 *
 * Buttons come from the plugin registry (core preset + plugins) in both.
 * Active state is resolved per item: an explicit `isActive`, else the item's
 * command's `isActive` via `SelectionInfo.marks`.
 */

import type { EditorContext, SelectionInfo, ToolbarItem } from "./types.js";
import { guard } from "./plugin.js";

function buildButtons(
  el: HTMLElement,
  items: ToolbarItem[],
  ctx: EditorContext,
): Map<string, HTMLButtonElement> {
  const buttons = new Map<string, HTMLButtonElement>();
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
        if (item.run) item.run(ctx);
        else if (item.command) ctx.exec(item.command as string, item.payload);
      });
    });
    buttons.set(item.id, btn);
    el.appendChild(btn);
  }
  return buttons;
}

function refreshActive(
  items: ToolbarItem[],
  buttons: Map<string, HTMLButtonElement>,
  info: SelectionInfo,
  ctx: EditorContext,
): void {
  for (const item of items) {
    const btn = buttons.get(item.id);
    if (!btn) continue;
    const active = item.isActive
      ? !!guard("toolbar", `isActive "${item.id}"`, () => item.isActive!(info, ctx))
      : !!(item.command && info.marks[item.command]);
    btn.classList.toggle("is-active", active);
  }
}

export class SelectionToolbar {
  private el: HTMLElement;
  private buttons: Map<string, HTMLButtonElement>;

  constructor(private items: ToolbarItem[], private ctx: EditorContext) {
    this.el = document.createElement("div");
    this.el.className = "ew ew-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.addEventListener("mousedown", (e) => e.preventDefault());
    this.buttons = buildButtons(this.el, items, ctx);
    document.body.appendChild(this.el);
  }

  update(info: SelectionInfo | null): void {
    if (!info || info.collapsed || info.empty || !info.rect) {
      this.hide();
      return;
    }
    refreshActive(this.items, this.buttons, info, this.ctx);
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

export class FixedToolbar {
  private el: HTMLElement;
  private buttons: Map<string, HTMLButtonElement>;

  /** Docked INSIDE the editor host, before the content element. */
  constructor(
    private items: ToolbarItem[],
    private ctx: EditorContext,
    host: HTMLElement,
    before: HTMLElement,
  ) {
    this.el = document.createElement("div");
    this.el.className = "ew-fixed-toolbar";
    this.el.setAttribute("role", "toolbar");
    // Buttons act on the current selection/caret — clicking one must not
    // steal focus from the content (same contract as the floating bar).
    this.el.addEventListener("mousedown", (e) => e.preventDefault());
    this.buttons = buildButtons(this.el, items, ctx);
    host.insertBefore(this.el, before);
  }

  /** Reflects formatting AT THE CARET too — a docked bar is visible while
   *  typing, so unlike the floating bar it never requires a selection. */
  update(info: SelectionInfo | null): void {
    if (!info) {
      for (const btn of this.buttons.values()) btn.classList.remove("is-active");
      return;
    }
    refreshActive(this.items, this.buttons, info, this.ctx);
  }

  setEnabled(enabled: boolean): void {
    this.el.classList.toggle("ew-fixed-toolbar--disabled", !enabled);
    for (const btn of this.buttons.values()) btn.disabled = !enabled;
  }

  destroy(): void {
    this.el.remove();
  }
}
