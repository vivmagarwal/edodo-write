/**
 * Block handles — the Notion-style left gutter that appears on hover with a
 * `+` (insert a block below) and a `⋮⋮` grip you drag to reorder blocks.
 *
 * Reordering is pure DOM: top-level block elements are moved among the
 * children of the editable root, then the editor re-serialises to Markdown.
 * A drag uses Pointer Events (not HTML5 DnD) so it never fights text selection,
 * shows a drop-indicator line, and drags a translucent ghost of the block.
 */

export interface BlockHandlesDeps {
  /** Called after a reorder or insert changes the document. */
  onChange: () => void;
  /** Insert an empty paragraph after `block` and focus it. */
  onInsertAfter: (block: HTMLElement) => void;
  /** A grip CLICK (pointer went down and up without dragging): open the
   *  block menu for `block`, anchored to the handle. */
  onMenu: (block: HTMLElement, anchor: HTMLElement) => void;
}

export class BlockHandles {
  private handle: HTMLElement;
  private line: HTMLElement;
  private hovered: HTMLElement | null = null;
  private dragging: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  private dropBefore: HTMLElement | null = null;
  private raf = 0;
  private enabled = true;

  private onRootMove = (e: MouseEvent) => this.trackHover(e);
  private onRootLeave = () => { if (!this.dragging) this.hide(); };
  private onDocPointerMove = (e: PointerEvent) => this.dragMove(e);
  private onDocPointerUp = (e: PointerEvent) => this.dragEnd(e);

  constructor(private root: HTMLElement, private host: HTMLElement, private deps: BlockHandlesDeps) {
    this.handle = document.createElement("div");
    this.handle.className = "ew-block-handle";
    this.handle.contentEditable = "false";
    this.handle.innerHTML =
      '<button type="button" class="ew-bh-add" title="Insert block below" aria-label="Insert block below">+</button>' +
      '<button type="button" class="ew-bh-drag" title="Drag to move, click for menu" aria-label="Drag to move, click for menu">⣿</button>';
    this.handle.style.display = "none";

    this.line = document.createElement("div");
    this.line.className = "ew-drop-line";
    this.line.style.display = "none";

    host.appendChild(this.handle);
    host.appendChild(this.line);

    this.handle.querySelector(".ew-bh-add")!.addEventListener("mousedown", (e) => e.preventDefault());
    this.handle.querySelector(".ew-bh-add")!.addEventListener("click", (e) => {
      e.preventDefault();
      if (this.hovered) this.deps.onInsertAfter(this.hovered);
    });
    const grip = this.handle.querySelector(".ew-bh-drag") as HTMLElement;
    grip.addEventListener("pointerdown", (e) => this.dragStart(e as PointerEvent));

    root.addEventListener("mousemove", this.onRootMove);
    host.addEventListener("mouseleave", this.onRootLeave);
    this.handle.addEventListener("mouseenter", () => {
      // Zeroing matters: a cancelled id left in `raf` would dead-lock
      // trackHover's `if (this.raf) return` guard for good.
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    });
  }

  /** Read-only support: disabling hides the gutter and inert-s hover + drag. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
      if (this.dragging) this.dragEnd(new PointerEvent("pointerup"));
    }
  }

  // ── Hover tracking ─────────────────────────────────────────────────────────

  private trackHover(e: MouseEvent): void {
    if (!this.enabled) return;
    if (this.dragging) return;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.enabled) return; // setReadOnly can land inside the mousemove→frame gap
      const block = this.blockFrom(e.target as Node);
      if (block && block !== this.hovered) {
        this.hovered = block;
        this.position(block);
      }
    });
  }

  private blockFrom(node: Node | null): HTMLElement | null {
    let el: Node | null = node;
    while (el && el.parentNode !== this.root) el = el.parentNode;
    return el && el.nodeType === 1 && el.parentNode === this.root ? (el as HTMLElement) : null;
  }

  private position(block: HTMLElement): void {
    const b = block.getBoundingClientRect();
    const h = this.host.getBoundingClientRect();
    this.handle.style.display = "flex";
    const top = b.top - h.top + Math.max(0, (firstLineHeight(block) - 22) / 2);
    this.handle.style.top = `${Math.round(top)}px`;
    const left = b.left - h.left - this.handle.offsetWidth - 2;
    this.handle.style.left = `${Math.round(Math.max(0, left))}px`;
  }

  private hide(): void {
    // A reposition still in flight would re-show what we just hid.
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.handle.style.display = "none";
    this.hovered = null;
  }

  // ── Drag ─────────────────────────────────────────────────────────────────

  private dragStart(e: PointerEvent): void {
    if (!this.enabled || !this.hovered) return;
    e.preventDefault();
    this.dragging = this.hovered;
    this.moved = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.dragging.classList.add("ew-block-dragging");
    document.body.classList.add("ew-dragging-active");

    const rect = this.dragging.getBoundingClientRect();
    this.ghost = this.dragging.cloneNode(true) as HTMLElement;
    this.ghost.className = "ew-drag-ghost ew-content";
    this.ghost.style.width = `${rect.width}px`;
    this.ghost.style.left = `${rect.left}px`;
    this.ghost.style.top = `${rect.top}px`;
    this.ghost.style.display = "none"; // revealed on first real movement
    document.body.appendChild(this.ghost);
    this.ghostOffsetY = e.clientY - rect.top;

    document.addEventListener("pointermove", this.onDocPointerMove);
    document.addEventListener("pointerup", this.onDocPointerUp);
  }

  private ghostOffsetY = 0;
  private moved = false;
  private startX = 0;
  private startY = 0;

  private dragMove(e: PointerEvent): void {
    if (!this.dragging) return;
    e.preventDefault();
    if (!this.moved && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < 4) {
      return; // still a click, not a drag
    }
    this.moved = true;
    if (this.ghost) {
      this.ghost.style.display = "";
      this.ghost.style.top = `${e.clientY - this.ghostOffsetY}px`;
    }
    const y = e.clientY;
    const kids = Array.from(this.root.children).filter((c) => c !== this.dragging) as HTMLElement[];
    let before: HTMLElement | null = null;
    for (const c of kids) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    this.dropBefore = before;
    this.showLine(before);
  }

  private showLine(before: HTMLElement | null): void {
    const h = this.host.getBoundingClientRect();
    const cr = this.root.getBoundingClientRect();
    let top: number;
    if (before) {
      top = before.getBoundingClientRect().top - h.top;
    } else {
      const last = this.root.lastElementChild;
      top = last ? last.getBoundingClientRect().bottom - h.top : 0;
    }
    this.line.style.display = "block";
    this.line.style.top = `${Math.round(top) - 1}px`;
    this.line.style.left = `${Math.round(cr.left - h.left)}px`;
    this.line.style.width = `${Math.round(cr.width)}px`;
  }

  private dragEnd(e: PointerEvent): void {
    document.removeEventListener("pointermove", this.onDocPointerMove);
    document.removeEventListener("pointerup", this.onDocPointerUp);
    const dragging = this.dragging;
    this.line.style.display = "none";
    document.body.classList.remove("ew-dragging-active");
    this.ghost?.remove();
    this.ghost = null;
    if (dragging) {
      dragging.classList.remove("ew-block-dragging");
      if (!this.moved) {
        // Pointer never moved: this was a CLICK on the grip → block menu.
        this.dragging = null;
        this.dropBefore = null;
        this.deps.onMenu(dragging, this.handle);
        return;
      }
      const before = this.dropBefore;
      if (before !== dragging) {
        if (before) this.root.insertBefore(dragging, before);
        else this.root.appendChild(dragging);
        this.deps.onChange();
      }
    }
    this.dragging = null;
    this.dropBefore = null;
    this.hide();
  }

  destroy(): void {
    this.root.removeEventListener("mousemove", this.onRootMove);
    this.host.removeEventListener("mouseleave", this.onRootLeave);
    document.removeEventListener("pointermove", this.onDocPointerMove);
    document.removeEventListener("pointerup", this.onDocPointerUp);
    this.handle.remove();
    this.line.remove();
    this.ghost?.remove();
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}

function firstLineHeight(block: HTMLElement): number {
  const cs = getComputedStyle(block);
  const lh = parseFloat(cs.lineHeight);
  return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.5;
}
