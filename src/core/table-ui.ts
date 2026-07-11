/**
 * Table hover controls — the Notion-style authoring surface for tables.
 *
 * Hovering a table cell reveals:
 *   • a COLUMN handle (pill) centered above the hovered column,
 *   • a ROW handle at the left edge of the hovered row,
 *   • "+" buttons on the table's right edge (add column) and bottom edge
 *     (add row).
 *
 * Clicking a handle opens a contextual menu (Insert left/right or
 * above/below, Move, Clear contents, Delete) anchored to the handle — the
 * operation applies to the column/row you are POINTING at, never to some
 * remembered caret. This replaces the earlier block-menu table entries,
 * whose dependence on the caret's cell made them silently no-op when the
 * caret was elsewhere (the discoverability bug the hover UI exists to fix).
 *
 * GFM constraints enforced here, not hidden: the header row cannot be
 * deleted, moved, or preceded (Markdown tables require it); the last column
 * cannot be deleted (a zero-column table isn't a table).
 */

import type { EditorUI } from "./types.js";
import { placeCaretAtStart } from "./dom.js";

export interface TableControlsDeps {
  /** Run a structural mutation as ONE undo step + change event. */
  commit(fn: () => void): void;
  ui: EditorUI;
}

const HANDLE_HIDE_DELAY = 120;

export class TableControls {
  private colHandle: HTMLButtonElement;
  private rowHandle: HTMLButtonElement;
  private addCol: HTMLButtonElement;
  private addRow: HTMLButtonElement;
  private table: HTMLElement | null = null;
  private colIndex = 0;
  private row: HTMLTableRowElement | null = null;
  private enabled = true;
  private menuOpen = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;

  private onRootMove = (e: MouseEvent) => this.trackHover(e);
  private onRootLeave = () => this.scheduleHide();

  constructor(
    private root: HTMLElement,
    private host: HTMLElement,
    private deps: TableControlsDeps,
  ) {
    const make = (className: string, label: string, title: string): HTMLButtonElement => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `ew-table-handle ${className}`;
      el.textContent = label;
      el.title = title;
      el.setAttribute("aria-label", title);
      el.setAttribute("contenteditable", "false");
      el.style.display = "none";
      el.addEventListener("mousedown", (ev) => ev.preventDefault());
      el.addEventListener("mouseenter", () => this.cancelHide());
      host.appendChild(el);
      return el;
    };
    this.colHandle = make("ew-th-col", "⋯", "Column options");
    this.rowHandle = make("ew-th-row", "⋮", "Row options");
    this.addCol = make("ew-th-addcol", "+", "Add column");
    this.addRow = make("ew-th-addrow", "+", "Add row");

    this.colHandle.addEventListener("click", (e) => { e.preventDefault(); this.openColumnMenu(); });
    this.rowHandle.addEventListener("click", (e) => { e.preventDefault(); this.openRowMenu(); });
    this.addCol.addEventListener("click", (e) => {
      e.preventDefault();
      const table = this.table;
      if (!table) return;
      const cols = table.querySelector("tr")?.children.length ?? 0;
      this.deps.commit(() => insertColumn(table, cols - 1, "right"));
      this.reposition();
    });
    this.addRow.addEventListener("click", (e) => {
      e.preventDefault();
      const table = this.table;
      if (!table) return;
      this.deps.commit(() => {
        const rows = table.querySelectorAll("tr");
        insertRow(table, rows[rows.length - 1], "below");
      });
      this.reposition();
    });

    root.addEventListener("mousemove", this.onRootMove);
    root.addEventListener("mouseleave", this.onRootLeave);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  destroy(): void {
    this.root.removeEventListener("mousemove", this.onRootMove);
    this.root.removeEventListener("mouseleave", this.onRootLeave);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.colHandle.remove();
    this.rowHandle.remove();
    this.addCol.remove();
    this.addRow.remove();
  }

  // ── Hover tracking ─────────────────────────────────────────────────────────

  private trackHover(e: MouseEvent): void {
    if (!this.enabled || this.menuOpen) return;
    if (this.raf) return;
    const target = e.target as HTMLElement;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const cell = target?.closest?.("td, th") as HTMLElement | null;
      const table = cell?.closest("table") as HTMLElement | null;
      if (!cell || !table || !this.root.contains(table)) {
        this.scheduleHide();
        return;
      }
      this.cancelHide();
      this.table = table;
      this.row = cell.closest("tr");
      this.colIndex = Array.from(cell.parentElement?.children ?? []).indexOf(cell);
      this.reposition();
    });
  }

  private reposition(): void {
    const table = this.table;
    const row = this.row;
    if (!table || !row) return;
    const hostRect = this.host.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const firstRow = table.querySelector("tr");
    const refCell = firstRow?.children[this.colIndex] as HTMLElement | undefined;

    if (refCell) {
      const c = refCell.getBoundingClientRect();
      this.colHandle.style.display = "flex";
      this.colHandle.style.left = `${Math.round(c.left - hostRect.left + c.width / 2 - 14)}px`;
      this.colHandle.style.top = `${Math.round(tableRect.top - hostRect.top - 9)}px`;
    }
    const r = row.getBoundingClientRect();
    this.rowHandle.style.display = "flex";
    this.rowHandle.style.left = `${Math.round(tableRect.left - hostRect.left - 9)}px`;
    this.rowHandle.style.top = `${Math.round(r.top - hostRect.top + r.height / 2 - 14)}px`;

    this.addCol.style.display = "flex";
    this.addCol.style.left = `${Math.round(tableRect.right - hostRect.left - 4)}px`;
    this.addCol.style.top = `${Math.round(tableRect.top - hostRect.top + tableRect.height / 2 - 14)}px`;

    this.addRow.style.display = "flex";
    this.addRow.style.left = `${Math.round(tableRect.left - hostRect.left + tableRect.width / 2 - 14)}px`;
    this.addRow.style.top = `${Math.round(tableRect.bottom - hostRect.top - 4)}px`;
  }

  private scheduleHide(): void {
    if (this.menuOpen) return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), HANDLE_HIDE_DELAY);
  }

  private cancelHide(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  private hide(): void {
    this.colHandle.style.display = "none";
    this.rowHandle.style.display = "none";
    this.addCol.style.display = "none";
    this.addRow.style.display = "none";
  }

  // ── Menus ──────────────────────────────────────────────────────────────────

  private openColumnMenu(): void {
    const table = this.table;
    if (!table) return;
    const index = this.colIndex;
    const cols = table.querySelector("tr")?.children.length ?? 0;
    this.menuOpen = true;
    this.deps.ui.menu({
      anchor: this.colHandle,
      onClose: () => { this.menuOpen = false; this.scheduleHide(); },
      items: [
        { id: "col-insert-left", title: "Insert left", action: () => this.deps.commit(() => insertColumn(table, index, "left")) },
        { id: "col-insert-right", title: "Insert right", action: () => this.deps.commit(() => insertColumn(table, index, "right")) },
        { id: "col-move-left", title: "Move left", disabled: index === 0, action: () => this.deps.commit(() => moveColumn(table, index, -1)) },
        { id: "col-move-right", title: "Move right", disabled: index >= cols - 1, action: () => this.deps.commit(() => moveColumn(table, index, 1)) },
        { id: "col-clear", title: "Clear contents", action: () => this.deps.commit(() => clearColumn(table, index)) },
        {
          id: "col-delete", title: "Delete column", danger: true, disabled: cols <= 1,
          action: () => this.deps.commit(() => deleteColumn(table, index)),
        },
      ],
    });
  }

  private openRowMenu(): void {
    const table = this.table;
    const row = this.row;
    if (!table || !row) return;
    const isHeader = isHeaderRow(row);
    this.menuOpen = true;
    this.deps.ui.menu({
      anchor: this.rowHandle,
      onClose: () => { this.menuOpen = false; this.scheduleHide(); },
      items: [
        {
          id: "row-insert-above", title: "Insert above", disabled: isHeader,
          action: () => this.deps.commit(() => insertRow(table, row, "above")),
        },
        { id: "row-insert-below", title: "Insert below", action: () => this.deps.commit(() => insertRow(table, row, "below")) },
        {
          id: "row-move-up", title: "Move up", disabled: isHeader || isFirstBodyRow(row),
          action: () => this.deps.commit(() => moveRow(row, -1)),
        },
        {
          id: "row-move-down", title: "Move down", disabled: isHeader || !row.nextElementSibling,
          action: () => this.deps.commit(() => moveRow(row, 1)),
        },
        { id: "row-clear", title: "Clear contents", action: () => this.deps.commit(() => clearRow(row)) },
        {
          id: "row-delete",
          title: isHeader ? "Delete row (header is required)" : "Delete row",
          danger: true,
          disabled: isHeader,
          action: () => this.deps.commit(() => deleteRow(table, row)),
        },
      ],
    });
  }
}

// ── Structural operations (exported for tests) ──────────────────────────────

function isHeaderRow(row: HTMLTableRowElement): boolean {
  return !!row.closest("thead") || row.querySelector("th") != null;
}

function isFirstBodyRow(row: HTMLTableRowElement): boolean {
  return !row.previousElementSibling;
}

function anchorCell(kind: "th" | "td"): HTMLElement {
  const cell = document.createElement(kind);
  cell.appendChild(document.createElement("br"));
  return cell;
}

export function insertColumn(table: HTMLElement, index: number, where: "left" | "right"): void {
  const at = where === "left" ? index : index + 1;
  let caretTarget: HTMLElement | null = null;
  table.querySelectorAll("tr").forEach((tr) => {
    const isHead = isHeaderRow(tr);
    const cell = anchorCell(isHead ? "th" : "td");
    const ref = tr.children[at];
    if (ref) tr.insertBefore(cell, ref);
    else tr.appendChild(cell);
    if (!caretTarget) caretTarget = cell;
  });
  if (caretTarget) placeCaretAtStart(caretTarget);
}

export function deleteColumn(table: HTMLElement, index: number): void {
  const cols = table.querySelector("tr")?.children.length ?? 0;
  if (cols <= 1) return;
  table.querySelectorAll("tr").forEach((tr) => tr.children[index]?.remove());
  const land = table.querySelector("tr")?.children[Math.min(index, cols - 2)] as HTMLElement | undefined;
  if (land) placeCaretAtStart(land);
}

export function moveColumn(table: HTMLElement, index: number, delta: -1 | 1): void {
  const cols = table.querySelector("tr")?.children.length ?? 0;
  const to = index + delta;
  if (to < 0 || to >= cols) return;
  table.querySelectorAll("tr").forEach((tr) => {
    const cell = tr.children[index];
    const target = tr.children[to];
    if (!cell || !target) return;
    if (delta === -1) tr.insertBefore(cell, target);
    else tr.insertBefore(cell, target.nextSibling);
  });
  const moved = table.querySelector("tr")?.children[to] as HTMLElement | undefined;
  if (moved) placeCaretAtStart(moved);
}

export function clearColumn(table: HTMLElement, index: number): void {
  table.querySelectorAll("tr").forEach((tr) => {
    const cell = tr.children[index] as HTMLElement | undefined;
    if (cell) {
      cell.textContent = "";
      cell.appendChild(document.createElement("br"));
    }
  });
  const first = table.querySelector("tr")?.children[index] as HTMLElement | undefined;
  if (first) placeCaretAtStart(first);
}

export function insertRow(table: HTMLElement, ref: HTMLTableRowElement, where: "above" | "below"): void {
  const cols = table.querySelector("tr")?.children.length ?? 1;
  const tr = document.createElement("tr");
  for (let i = 0; i < cols; i++) tr.appendChild(anchorCell("td"));

  if (isHeaderRow(ref)) {
    // Rows never enter the <thead>; "below" the header means first body row.
    const tbody = table.querySelector("tbody") ?? table.appendChild(document.createElement("tbody"));
    tbody.prepend(tr);
  } else if (where === "above") {
    ref.before(tr);
  } else {
    ref.after(tr);
  }
  placeCaretAtStart(tr.firstElementChild as HTMLElement);
}

export function deleteRow(table: HTMLElement, row: HTMLTableRowElement): void {
  if (isHeaderRow(row)) return;
  const land = (row.nextElementSibling ?? row.previousElementSibling ?? table.querySelector("tr"))
    ?.querySelector("td, th") as HTMLElement | null;
  row.remove();
  if (land) placeCaretAtStart(land);
}

export function moveRow(row: HTMLTableRowElement, delta: -1 | 1): void {
  if (isHeaderRow(row)) return;
  if (delta === -1) {
    const prev = row.previousElementSibling as HTMLTableRowElement | null;
    if (!prev || isHeaderRow(prev)) return;
    prev.before(row);
  } else {
    const next = row.nextElementSibling;
    if (!next) return;
    next.after(row);
  }
  placeCaretAtStart(row.firstElementChild as HTMLElement);
}

export function clearRow(row: HTMLTableRowElement): void {
  Array.from(row.children).forEach((cell) => {
    (cell as HTMLElement).textContent = "";
    cell.appendChild(document.createElement("br"));
  });
  placeCaretAtStart(row.firstElementChild as HTMLElement);
}
