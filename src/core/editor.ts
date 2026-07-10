/**
 * EdodoWrite — the framework-free editor controller.
 *
 *   const editor = new EdodoWrite(el, { value: "# Hello", onChange: md => … });
 *
 * It mounts a `contentEditable` surface, seeds it from Markdown, and keeps
 * Markdown as the source of truth: every edit re-serialises the DOM back to
 * Markdown (`getMarkdown()`), and `setMarkdown()` re-hydrates it. Type-to-format
 * input rules, a floating toolbar, and a slash menu provide the Notion/Medium
 * feel. React is never imported here.
 */

import type { Command, EditorEventName, EditorEvents, EditorOptions, SelectionInfo } from "./types.js";
import { parseMarkdown } from "./parse.js";
import { htmlToMarkdown } from "./serialize.js";
import { applyCommand, isInlineActive } from "./commands.js";
import { runInputRules } from "./input-rules.js";
import { handleKeydown } from "./keymap.js";
import { SelectionToolbar } from "./toolbar.js";
import { SlashMenu } from "./slash-menu.js";
import {
  blockKindOf, currentBlock, getSelection, selectionInside, selectionRect,
} from "./dom.js";

const EMPTY_DOC = "<p><br></p>";

export class EdodoWrite {
  readonly host: HTMLElement;
  readonly content: HTMLElement;
  private opts: Required<Pick<EditorOptions, "placeholder" | "toolbar" | "slashMenu" | "spellcheck" | "readOnly">>;
  private toolbar: SelectionToolbar | null = null;
  private slash: SlashMenu | null = null;
  private listeners: { [K in EditorEventName]: Set<EditorEvents[K]> } = {
    change: new Set(), selection: new Set(), focus: new Set(), blur: new Set(),
  };
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private applying = false;
  private destroyed = false;

  // Bound handlers (kept for removal on destroy).
  private onInput = () => this.handleInput();
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);
  private onSelectionChange = () => this.handleSelectionChange();
  private onFocus = () => this.emit("focus");
  private onBlur = () => { this.slash?.close(); this.toolbar?.hide(); this.emit("blur"); };
  private onClick = (e: MouseEvent) => this.handleClick(e);
  private onPaste = (e: ClipboardEvent) => this.handlePaste(e);

  constructor(host: HTMLElement, options: EditorOptions = {}) {
    this.host = host;
    this.opts = {
      placeholder: options.placeholder ?? "Write something, or type “/” for commands…",
      toolbar: options.toolbar ?? true,
      slashMenu: options.slashMenu ?? true,
      spellcheck: options.spellcheck ?? true,
      readOnly: options.readOnly ?? false,
    };

    host.classList.add("ew");
    if (options.className) host.classList.add(...options.className.split(/\s+/).filter(Boolean));

    this.content = document.createElement("div");
    this.content.className = "ew-content";
    this.content.setAttribute("contenteditable", this.opts.readOnly ? "false" : "true");
    this.content.spellcheck = this.opts.spellcheck;
    this.content.setAttribute("role", "textbox");
    this.content.setAttribute("aria-multiline", "true");
    if (options.ariaLabel) this.content.setAttribute("aria-label", options.ariaLabel);
    this.content.dataset.placeholder = this.opts.placeholder;
    host.appendChild(this.content);

    this.setMarkdown(options.value ?? "", { silent: true });

    if (options.onChange) this.on("change", options.onChange);

    if (!this.opts.readOnly) {
      if (this.opts.toolbar) {
        this.toolbar = new SelectionToolbar({
          exec: (cmd) => this.exec(cmd),
          requestLink: () => this.requestLink(),
        });
      }
      if (this.opts.slashMenu) {
        this.slash = new SlashMenu(this.content, (cmd) => this.exec(cmd));
      }
      this.content.addEventListener("input", this.onInput);
      this.content.addEventListener("keydown", this.onKeyDown);
      this.content.addEventListener("focus", this.onFocus);
      this.content.addEventListener("blur", this.onBlur);
      this.content.addEventListener("paste", this.onPaste);
      document.addEventListener("selectionchange", this.onSelectionChange);
    }
    this.content.addEventListener("click", this.onClick);

    if (options.autofocus && !this.opts.readOnly) this.focus();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  getMarkdown(): string {
    return htmlToMarkdown(this.content.innerHTML);
  }

  setMarkdown(md: string, opts: { silent?: boolean } = {}): void {
    const html = parseMarkdown(md ?? "");
    this.content.innerHTML = html.trim() || EMPTY_DOC;
    this.ensureNotEmptyStructure();
    this.updatePlaceholder();
    if (!opts.silent) this.scheduleChange();
  }

  getHTML(): string {
    return this.content.innerHTML;
  }

  isEmpty(): boolean {
    const text = (this.content.textContent ?? "").replace(/​/g, "").trim();
    return text === "" && !this.content.querySelector("img,hr,input,pre");
  }

  focus(): void {
    this.content.focus();
  }

  blur(): void {
    this.content.blur();
  }

  /** Apply a formatting command (also used internally by toolbar/keymap/slash). */
  exec(cmd: Command, payload?: { href?: string | null }): void {
    if (this.opts.readOnly) return;
    applyCommand(this.content, cmd, payload);
    this.afterMutation();
  }

  setReadOnly(readOnly: boolean): void {
    this.opts.readOnly = readOnly;
    this.content.setAttribute("contenteditable", readOnly ? "false" : "true");
    if (readOnly) { this.toolbar?.hide(); this.slash?.close(); }
  }

  on<K extends EditorEventName>(event: K, handler: EditorEvents[K]): () => void {
    this.listeners[event].add(handler);
    return () => this.off(event, handler);
  }

  off<K extends EditorEventName>(event: K, handler: EditorEvents[K]): void {
    this.listeners[event].delete(handler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.content.removeEventListener("input", this.onInput);
    this.content.removeEventListener("keydown", this.onKeyDown);
    this.content.removeEventListener("focus", this.onFocus);
    this.content.removeEventListener("blur", this.onBlur);
    this.content.removeEventListener("paste", this.onPaste);
    this.content.removeEventListener("click", this.onClick);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.toolbar?.destroy();
    this.slash?.destroy();
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.content.remove();
    (["change", "selection", "focus", "blur"] as EditorEventName[]).forEach((e) => this.listeners[e].clear());
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private handleInput(): void {
    if (this.applying) return;
    this.applying = true;
    try {
      runInputRules(this.content);
    } finally {
      this.applying = false;
    }
    this.ensureNotEmptyStructure();
    this.updatePlaceholder();
    if (this.opts.slashMenu) this.slash?.sync();
    this.scheduleChange();
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.slash?.onKeyDown(e)) return;
    handleKeydown(this.content, e, {
      exec: (cmd) => this.exec(cmd),
      onLink: () => this.requestLink(),
      notify: () => this.afterMutation(),
    });
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target && target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
      if (this.opts.readOnly) { e.preventDefault(); return; }
      // Sync the attribute + li state to the just-toggled property, then notify.
      const box = target as HTMLInputElement;
      queueMicrotask(() => {
        if (box.checked) box.setAttribute("checked", "");
        else box.removeAttribute("checked");
        box.closest("li")?.setAttribute("data-task", box.checked ? "done" : "todo");
        this.afterMutation();
      });
    }
  }

  private handlePaste(e: ClipboardEvent): void {
    // Prefer pasting as plain text so we don't inject foreign HTML/styles;
    // Markdown typed in the pasted text still gets picked up by input rules
    // on the next keystroke. (A richer HTML→MD paste can come later.)
    const text = e.clipboardData?.getData("text/plain");
    if (text == null) return;
    e.preventDefault();
    document.execCommand("insertText", false, text);
  }

  private requestLink(): void {
    if (this.opts.readOnly) return;
    const url = window.prompt("Link URL (leave blank to remove):", "https://");
    if (url === null) return;
    this.exec("link", { href: url.trim() || null });
  }

  private afterMutation(): void {
    this.ensureNotEmptyStructure();
    this.updatePlaceholder();
    this.scheduleChange();
    this.handleSelectionChange();
  }

  private ensureNotEmptyStructure(): void {
    if (this.content.children.length === 0) {
      this.content.innerHTML = EMPTY_DOC;
    }
  }

  private updatePlaceholder(): void {
    this.content.classList.toggle("ew-content--empty", this.isEmpty());
  }

  private scheduleChange(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      const md = this.getMarkdown();
      this.listeners.change.forEach((fn) => fn(md));
    }, 120);
  }

  private handleSelectionChange(): void {
    if (this.destroyed) return;
    const info = this.buildSelectionInfo();
    if (this.opts.toolbar) this.toolbar?.update(info);
    this.listeners.selection.forEach((fn) => fn(info));
  }

  private buildSelectionInfo(): SelectionInfo | null {
    if (!selectionInside(this.content)) return null;
    const sel = getSelection();
    if (!sel) return null;
    const collapsed = sel.isCollapsed;
    const selected = sel.toString().trim();
    return {
      empty: collapsed || selected === "",
      collapsed,
      bold: isInlineActive(this.content, "bold"),
      italic: isInlineActive(this.content, "italic"),
      strike: isInlineActive(this.content, "strike"),
      code: isInlineActive(this.content, "code"),
      link: isInlineActive(this.content, "link"),
      block: blockKindOf(currentBlock(this.content)),
      rect: collapsed ? null : selectionRect(),
    };
  }

  private emit(event: "focus" | "blur"): void {
    this.listeners[event].forEach((fn) => (fn as () => void)());
  }
}
