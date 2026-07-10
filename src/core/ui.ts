/**
 * Editor-owned floating-UI primitives — the ONLY sanctioned way to render
 * plugin UI. Every floating surface needs the same safety properties, so they
 * are implemented once here instead of rediscovered per feature:
 *
 *   • body portal (never clipped by the editor's overflow), inside an
 *     `.ew.ew-layer` element so the theme variables apply;
 *   • viewport clamping;
 *   • `mousedown` prevention on the frame — clicking a button must not
 *     collapse the selection it is about to act on — but NOT on form fields,
 *     which need focus to be typeable;
 *   • the editor's selection Range is saved on open and restored before any
 *     action / on close, so a popover with an `<input>` can steal focus
 *     without destroying the selection it operates on;
 *   • dismissal on Escape / outside pointerdown / window scroll;
 *   • forced teardown on `editor.destroy()` and `setReadOnly(true)`;
 *   • one popover per editor at a time (opening a second closes the first).
 */

import type { EditorUI, MenuOptions, PopoverOptions, PopoverHandle } from "./types.js";
import { getRange, getSelection } from "./dom.js";

interface ActivePopover {
  el: HTMLElement;
  cleanup: () => void;
}

export class EditorUIImpl implements EditorUI {
  private layer: HTMLElement;
  private active: ActivePopover | null = null;

  constructor(private editorRoot: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "ew ew-layer";
    document.body.appendChild(this.layer);
  }

  // ── Selection preservation ────────────────────────────────────────────────

  private savedRange: Range | null = null;

  private saveSelection(): void {
    const range = getRange();
    this.savedRange =
      range && (this.editorRoot.contains(range.startContainer) || range.startContainer === this.editorRoot)
        ? range.cloneRange()
        : null;
  }

  /** Restore the selection saved when the popover opened. Safe to call twice. */
  restoreSelection(): void {
    if (!this.savedRange) return;
    const sel = getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(this.savedRange.cloneRange());
  }

  // ── Popover ───────────────────────────────────────────────────────────────

  popover(opts: PopoverOptions): PopoverHandle {
    this.closeAll();
    this.saveSelection();

    const el = document.createElement("div");
    el.className = "ew-popover";
    el.setAttribute("contenteditable", "false");
    this.layer.appendChild(el);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      renderCleanup?.();
      el.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      if (this.active?.el === el) this.active = null;
      opts.onClose?.();
    };

    // Keep the editor selection alive: block focus-stealing mousedown on the
    // frame, but let form fields take focus.
    el.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) e.preventDefault();
    });

    const onOutside = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    };
    const onScroll = (e: Event) => {
      if (!el.contains(e.target as Node)) close();
    };
    // Deferred so the opening click doesn't immediately dismiss.
    setTimeout(() => {
      if (closed) return;
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", onScroll, true);
    }, 0);

    const renderCleanup = opts.render(el, close) ?? undefined;
    position(el, opts.anchor, opts.placement ?? "below");

    this.active = { el, cleanup: close };
    return { close, el };
  }

  // ── Menu (keyboard-navigable list) ────────────────────────────────────────

  menu(opts: MenuOptions): PopoverHandle {
    return this.popover({
      anchor: opts.anchor,
      onClose: opts.onClose,
      render: (container, close) => {
        container.classList.add("ew-menu");
        container.setAttribute("role", "menu");
        const enabled = opts.items.filter((it) => !it.disabled);
        let index = 0;
        const rows: HTMLButtonElement[] = [];
        // Hover highlighting only after real mouse movement — the menu can
        // open under the resting pointer.
        let mouseArmed = false;
        container.addEventListener("mousemove", () => { mouseArmed = true; }, { once: true });

        let lastGroup: string | undefined;
        for (const item of opts.items) {
          if (item.group && item.group !== lastGroup) {
            const head = document.createElement("div");
            head.className = "ew-menu__group";
            head.textContent = item.group;
            container.appendChild(head);
            lastGroup = item.group;
          }
          const row = document.createElement("button");
          row.type = "button";
          row.className = "ew-menu__item" + (item.danger ? " is-danger" : "");
          row.setAttribute("role", "menuitem");
          row.id = `ew-menu-${item.id}`;
          row.disabled = !!item.disabled;
          const title = document.createElement("span");
          title.className = "ew-menu__title";
          title.textContent = item.title;
          row.appendChild(title);
          if (item.hint) {
            const hint = document.createElement("span");
            hint.className = "ew-menu__hint";
            hint.textContent = item.hint;
            row.appendChild(hint);
          }
          row.addEventListener("mouseenter", () => {
            if (!mouseArmed) return;
            const i = enabled.indexOf(item);
            if (i >= 0) { index = i; highlight(); }
          });
          row.addEventListener("click", (e) => {
            e.preventDefault();
            close();
            item.action();
          });
          container.appendChild(row);
          if (!item.disabled) rows.push(row);
        }

        const highlight = () => {
          rows.forEach((r, i) => r.classList.toggle("is-active", i === index));
          rows[index]?.scrollIntoView({ block: "nearest" });
        };
        highlight();

        const onKey = (e: KeyboardEvent) => {
          if (e.key === "ArrowDown") {
            e.preventDefault(); e.stopPropagation();
            index = (index + 1) % enabled.length;
            highlight();
          } else if (e.key === "ArrowUp") {
            e.preventDefault(); e.stopPropagation();
            index = (index - 1 + enabled.length) % enabled.length;
            highlight();
          } else if (e.key === "Enter") {
            e.preventDefault(); e.stopPropagation();
            const item = enabled[index];
            close();
            item?.action();
          }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
      },
    });
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  notify(message: string): void {
    const toast = document.createElement("div");
    toast.className = "ew-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    this.layer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  closeAll(): void {
    this.active?.cleanup();
    this.active = null;
    this.savedRange = null;
  }

  destroy(): void {
    this.closeAll();
    this.layer.remove();
  }
}

/**
 * A small labeled-fields form inside a popover — shared by the link editor
 * and the image inserter. Internal helper, not part of the public EditorUI.
 */
export function buildFieldForm(
  container: HTMLElement,
  opts: {
    fields: Array<{ name: string; placeholder: string; value?: string; label: string }>;
    submitLabel: string;
    /** Extra action buttons rendered next to submit (e.g. "Remove"). */
    actions?: Array<{ label: string; danger?: boolean; onPick(): void }>;
    onSubmit(values: Record<string, string>): void;
  },
): void {
  const form = document.createElement("form");
  form.className = "ew-popover__form";
  const inputs = new Map<string, HTMLInputElement>();
  for (const field of opts.fields) {
    const input = document.createElement("input");
    input.type = "text";
    input.name = field.name;
    input.placeholder = field.placeholder;
    input.value = field.value ?? "";
    input.setAttribute("aria-label", field.label);
    input.className = "ew-popover__input";
    inputs.set(field.name, input);
    form.appendChild(input);
  }
  const row = document.createElement("div");
  row.className = "ew-popover__actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "ew-popover__btn ew-popover__btn--primary";
  submit.textContent = opts.submitLabel;
  row.appendChild(submit);
  for (const action of opts.actions ?? []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ew-popover__btn" + (action.danger ? " is-danger" : "");
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => { e.preventDefault(); action.onPick(); });
    row.appendChild(btn);
  }
  form.appendChild(row);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values: Record<string, string> = {};
    inputs.forEach((input, name) => { values[name] = input.value.trim(); });
    opts.onSubmit(values);
  });
  container.appendChild(form);
  setTimeout(() => inputs.values().next().value?.focus(), 0);
}

// ── Positioning ─────────────────────────────────────────────────────────────

function position(el: HTMLElement, anchor: HTMLElement | DOMRect, placement: "above" | "below"): void {
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const { width, height } = el.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let left = rect.left + scrollX;
  left = Math.max(8 + scrollX, Math.min(left, scrollX + document.documentElement.clientWidth - width - 8));
  let top = placement === "above"
    ? rect.top + scrollY - height - 8
    : rect.bottom + scrollY + 6;
  if (top < scrollY + 8) top = rect.bottom + scrollY + 6;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}
