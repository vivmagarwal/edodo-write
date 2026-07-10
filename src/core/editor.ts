/**
 * EdodoWrite — the framework-free editor controller.
 *
 *   const editor = new EdodoWrite(el, { value: "# Hello", onChange: md => … });
 *
 * The mental model (the "façade over Markdown"): the contentEditable surface
 * is the *view*, Markdown is the *state*, and parse/serialize is the
 * reconciler. Every edit re-serialises the view to Markdown (`getMarkdown()`);
 * `setMarkdown()` re-hydrates the view. Undo/redo is a stack of Markdown
 * snapshots — undo literally restores previous state. React is never imported.
 *
 * Extensibility: the constructor resolves `[corePreset(), ...options.plugins]`
 * into per-instance registries (commands, input rules, keymap, slash/toolbar/
 * block-menu items) and a per-instance markdown pipeline. Built-ins flow
 * through the exact same registries plugins use. The structural engine
 * (Enter/Backspace/Tab, history, clipboard, normalizer) is not pluggable.
 */

import type {
  AnyCommand, Command, EditorContext, EditorEventName, EditorEvents,
  EditorOptions, PayloadArgs, SelectionInfo,
} from "./types.js";
import { createMarkdownParser } from "./parse.js";
import { createMarkdownSerializer } from "./serialize.js";
import { sanitizeHtml } from "./sanitize.js";
import { runInputRules, type RuleSet } from "./input-rules.js";
import { handleKeydown } from "./keymap.js";
import { SelectionToolbar } from "./toolbar.js";
import { SlashMenu } from "./slash-menu.js";
import { BlockHandles } from "./block-handles.js";
import { handleCopyCut, handlePaste, insertMarkdown, type MarkdownPipeline } from "./clipboard.js";
import { normalizeDocument, isEffectivelyEmpty, visibleText } from "./normalize.js";
import { corePreset } from "./preset.js";
import { resolvePlugins, guard, type PluginRegistry } from "./plugin.js";
import { EditorUIImpl } from "./ui.js";
import { openLinkEditor } from "./link-ui.js";
import { toggleInlineTag, isInlineTagActive } from "./commands.js";
import {
  blockKindOf, currentBlock, currentListItem, getSelection, selectionInside,
  selectionRect, getCaretOffset, setCaretOffset, placeCaretAtStart,
  placeCaretAtEnd, placeCaretAfter, createElement, ensureNotEmpty,
  textBeforeCaret, isAtBlockStart, deleteLeadingChars,
} from "./dom.js";

const EMPTY_DOC = "<p><br></p>";
const HISTORY_LIMIT = 300;
const ZWSP = String.fromCharCode(0x200b);

interface Snapshot { md: string; caret: number; }

export class EdodoWrite {
  readonly host: HTMLElement;
  readonly content: HTMLElement;
  private opts: Required<Pick<EditorOptions, "placeholder" | "toolbar" | "slashMenu" | "spellcheck" | "readOnly">>;
  private registry: PluginRegistry;
  private pipeline: MarkdownPipeline;
  private rules: RuleSet;
  private ctx: EditorContext;
  private ui: EditorUIImpl;
  private toolbar: SelectionToolbar | null = null;
  private slash: SlashMenu | null = null;
  private blockHandles: BlockHandles | null = null;
  private pluginCleanups: Array<() => void> = [];
  private listeners: { [K in EditorEventName]: Set<EditorEvents[K]> } = {
    change: new Set(), selection: new Set(), focus: new Set(), blur: new Set(),
  };
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private applying = false;
  private destroyed = false;
  private transactionDepth = 0;

  // Undo/redo: a stack of Markdown snapshots.
  private history: Snapshot[] = [];
  private historyIndex = -1;
  private restoring = false;

  private onInput = (e: Event) => this.handleInput(e as InputEvent);
  private onBeforeInput = (e: Event) => this.handleBeforeInput(e as InputEvent);
  private onCompositionEnd = () => { if (!this.opts.readOnly) this.handleInput(); };
  private onKeyDown = (e: KeyboardEvent) => { if (!this.opts.readOnly) this.handleKey(e); };
  private onSelectionChange = () => this.handleSelectionChange();
  private onFocus = () => this.emit("focus");
  private onBlur = () => { this.slash?.close(); this.toolbar?.hide(); this.emit("blur"); };
  private onClick = (e: MouseEvent) => this.handleClick(e);
  private onCopy = (e: ClipboardEvent) => { if (handleCopyCut(e, false, this.pipeline)) { /* copy: no mutation */ } };
  private onCut = (e: ClipboardEvent) => {
    if (this.opts.readOnly) { e.preventDefault(); return; }
    if (handleCopyCut(e, true, this.pipeline)) {
      // A cut that removed everything leaves block shells (an emptied <h1>,
      // a list with no items) — collapse them to a fresh paragraph.
      if (isEffectivelyEmpty(this.content)) {
        this.content.innerHTML = EMPTY_DOC;
        placeCaretAtStart(this.content.firstElementChild as HTMLElement);
      }
      this.afterMutation();
    }
  };
  private onPaste = (e: ClipboardEvent) => {
    if (this.opts.readOnly) { e.preventDefault(); return; }
    if (handlePaste(this.content, e, this.pipeline)) this.afterMutation();
  };

  constructor(host: HTMLElement, options: EditorOptions = {}) {
    this.host = host;
    this.opts = {
      placeholder: options.placeholder ?? "Write something, or type “/” for commands…",
      toolbar: options.toolbar ?? true,
      slashMenu: options.slashMenu ?? true,
      spellcheck: options.spellcheck ?? true,
      readOnly: options.readOnly ?? false,
    };

    // Resolve plugins (throws on collisions) and build the instance pipeline.
    this.registry = resolvePlugins([corePreset(), ...(options.plugins ?? [])], options.exclude);
    const parse = createMarkdownParser(this.registry.markedExtensions, this.registry.sanitize);
    const serialize = createMarkdownSerializer(this.registry.turndownExtensions);
    this.pipeline = {
      parse,
      serialize,
      sanitize: (html) => sanitizeHtml(html, this.registry.sanitize),
    };
    this.rules = {
      block: this.registry.blockRules,
      inline: this.registry.inlineRules,
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

    this.ui = new EditorUIImpl(this.content);
    this.ctx = this.buildContext();

    this.setMarkdown(options.value ?? "", { silent: true });
    this.seedHistory();

    if (options.onChange) this.on("change", options.onChange);

    // Chrome (all editing UI) is created and listeners are attached
    // unconditionally; behavior is gated on the LIVE readOnly flag so
    // `setReadOnly()` can toggle a fully working editor in both directions.
    if (this.opts.toolbar) {
      this.toolbar = new SelectionToolbar(this.registry.toolbarItems, this.ctx);
    }
    if (this.opts.slashMenu) {
      this.slash = new SlashMenu(this.content, this.registry.slashItems, this.ctx);
    }
    this.blockHandles = new BlockHandles(this.content, this.host, {
      onChange: () => this.afterMutation(),
      onInsertAfter: (block) => this.insertParagraphAfter(block),
      onMenu: (block, anchor) => this.openBlockMenu(block, anchor),
    });
    this.blockHandles.setEnabled(!this.opts.readOnly);

    this.content.addEventListener("beforeinput", this.onBeforeInput);
    this.content.addEventListener("input", this.onInput);
    this.content.addEventListener("compositionend", this.onCompositionEnd);
    this.content.addEventListener("keydown", this.onKeyDown);
    this.content.addEventListener("focus", this.onFocus);
    this.content.addEventListener("blur", this.onBlur);
    this.content.addEventListener("copy", this.onCopy);
    this.content.addEventListener("cut", this.onCut);
    this.content.addEventListener("paste", this.onPaste);
    document.addEventListener("selectionchange", this.onSelectionChange);
    this.content.addEventListener("click", this.onClick);

    this.runPluginSetups();

    if (options.autofocus && !this.opts.readOnly) this.focus();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  getMarkdown(): string {
    return this.pipeline.serialize(this.content.innerHTML);
  }

  setMarkdown(md: string, opts: { silent?: boolean } = {}): void {
    const html = this.pipeline.parse(md ?? "");
    this.content.innerHTML = html.trim() || EMPTY_DOC;
    normalizeDocument(this.content);
    this.updatePlaceholder();
    if (!opts.silent) { this.recordHistory(); this.scheduleChange(); }
  }

  getHTML(): string {
    return this.content.innerHTML;
  }

  isEmpty(): boolean {
    const text = visibleText(this.content).trim();
    return text === "" && !this.content.querySelector("img,hr,input,pre");
  }

  focus(): void { this.content.focus(); }
  blur(): void { this.content.blur(); }

  /** Execute a registered command. Returns false when unregistered/refused. */
  exec<C extends AnyCommand>(cmd: C, ...args: PayloadArgs<C>): boolean {
    if (this.opts.readOnly) return false;
    const entry = this.registry.commands.get(cmd);
    if (!entry) {
      console.warn(`[edodo-write] unknown command "${cmd}"`);
      return false;
    }
    this.content.focus();
    const result = this.transact(() =>
      guard(entry.plugin, `command "${cmd}"`, () => entry.spec.run(this.ctx, args[0])),
    );
    // A void return means "done" — only an explicit `false` signals refusal.
    // (Were a void return treated as unhandled, a keybinding would fall
    // through to the browser default and apply the format twice.)
    return result !== false;
  }

  /** Batch DOM mutations into ONE undo step + ONE change event. Re-entrant. */
  transact<T>(fn: () => T): T {
    this.transactionDepth += 1;
    try {
      return fn();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) this.afterMutation();
    }
  }

  undo(): void {
    this.flushPendingHistory();
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.restore(this.history[this.historyIndex]);
  }

  redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.restore(this.history[this.historyIndex]);
  }

  setReadOnly(readOnly: boolean): void {
    this.opts.readOnly = readOnly;
    this.content.setAttribute("contenteditable", readOnly ? "false" : "true");
    this.blockHandles?.setEnabled(!readOnly);
    if (readOnly) {
      this.toolbar?.hide();
      this.slash?.close();
      this.ui.closeAll();
    }
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
    for (const cleanup of this.pluginCleanups) {
      try { cleanup(); } catch (err) { console.error("[edodo-write] plugin cleanup failed:", err); }
    }
    for (const plugin of this.registry.plugins) {
      if (plugin.on?.destroy) guard(plugin.name, "on.destroy", () => plugin.on!.destroy!(this.ctx));
    }
    this.content.removeEventListener("beforeinput", this.onBeforeInput);
    this.content.removeEventListener("input", this.onInput);
    this.content.removeEventListener("compositionend", this.onCompositionEnd);
    this.content.removeEventListener("keydown", this.onKeyDown);
    this.content.removeEventListener("focus", this.onFocus);
    this.content.removeEventListener("blur", this.onBlur);
    this.content.removeEventListener("copy", this.onCopy);
    this.content.removeEventListener("cut", this.onCut);
    this.content.removeEventListener("paste", this.onPaste);
    this.content.removeEventListener("click", this.onClick);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.toolbar?.destroy();
    this.slash?.destroy();
    this.blockHandles?.destroy();
    this.ui.destroy();
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.content.remove();
    (["change", "selection", "focus", "blur"] as EditorEventName[]).forEach((e) => this.listeners[e].clear());
  }

  // ── Context & plugin wiring ─────────────────────────────────────────────────

  private buildContext(): EditorContext {
    const root = this.content;
    return {
      editor: this,
      root,
      exec: (cmd, ...args) => this.exec(cmd, ...args),
      transact: (fn) => this.transact(fn),
      markdown: {
        parse: (md) => this.pipeline.parse(md),
        serialize: (html) => this.pipeline.serialize(html),
        insert: (md) => this.transact(() => insertMarkdown(root, md, this.pipeline)),
      },
      dom: {
        currentBlock: () => currentBlock(root),
        currentListItem: () => currentListItem(root),
        blockKindOf: (el) => blockKindOf(el),
        textBeforeCaret: (block) => textBeforeCaret(block).replace(/ /g, " ").split(ZWSP).join(""),
        isAtBlockStart: (block) => isAtBlockStart(block),
        deleteLeadingChars: (block, n) => deleteLeadingChars(block, n),
        ensureNotEmpty: (el) => ensureNotEmpty(el),
        placeCaretAtStart: (el) => placeCaretAtStart(el),
        placeCaretAtEnd: (el) => placeCaretAtEnd(el),
        placeCaretAfter: (node) => placeCaretAfter(node),
        toggleInlineTag: (tag) => toggleInlineTag(root, tag),
        isInlineTagActive: (tag) => isInlineTagActive(root, tag),
        selectionRect: () => selectionRect(),
      },
      ui: this.ui,
    };
  }

  private runPluginSetups(): void {
    for (const plugin of this.registry.plugins) {
      if (plugin.setup) {
        const cleanup = guard(plugin.name, "setup", () => plugin.setup!(this.ctx));
        if (typeof cleanup === "function") this.pluginCleanups.push(cleanup);
      }
      const hooks = plugin.on;
      if (!hooks) continue;
      if (hooks.change) this.on("change", (md) => guard(plugin.name, "on.change", () => hooks.change!(md, this.ctx)));
      if (hooks.selection) this.on("selection", (info) => guard(plugin.name, "on.selection", () => hooks.selection!(info, this.ctx)));
      if (hooks.focus) this.on("focus", () => guard(plugin.name, "on.focus", () => hooks.focus!(this.ctx)));
      if (hooks.blur) this.on("blur", () => guard(plugin.name, "on.blur", () => hooks.blur!(this.ctx)));
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private handleInput(e?: InputEvent): void {
    if (this.applying || this.opts.readOnly) return;
    // Never transform mid-IME-composition — input rules firing on a partial
    // composition string corrupt CJK/dead-key input. compositionend re-runs us.
    if (e?.isComposing) return;
    this.applying = true;
    try {
      // Repair whatever the native edit left behind (stray root text nodes,
      // emptied shells, styled spans) BEFORE matching input rules against it.
      this.normalize();
      runInputRules(this.content, this.rules, this.ctx);
    } finally {
      this.applying = false;
    }
    this.updatePlaceholder();
    if (this.opts.slashMenu) this.slash?.sync();
    this.scheduleChange();
  }

  /**
   * Typing or deleting over a select-all must reset the document to a plain
   * paragraph (Notion behavior) — natively, Chrome keeps the first block's
   * emptied shell and the replacement text lands inside a stale heading.
   */
  private handleBeforeInput(e: InputEvent): void {
    if (this.opts.readOnly || e.isComposing) return;
    const type = e.inputType;
    const replacing = type === "insertText" || type === "insertParagraph" ||
      type === "deleteContentBackward" || type === "deleteContentForward";
    if (!replacing || !this.isFullDocSelection()) return;
    e.preventDefault();
    this.content.innerHTML = EMPTY_DOC;
    const p = this.content.firstElementChild as HTMLElement;
    if (type === "insertText" && e.data) {
      p.textContent = e.data;
      const sel = getSelection();
      if (sel && p.firstChild) {
        const r = document.createRange();
        r.setStart(p.firstChild, (p.firstChild as Text).length);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } else {
      placeCaretAtStart(p);
    }
    this.afterMutation();
  }

  private isFullDocSelection(): boolean {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !selectionInside(this.content)) return false;
    const selected = sel.toString().replace(/\s+/g, "");
    const total = visibleText(this.content).replace(/\s+/g, "");
    return total.length > 0 && selected.length >= total.length;
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.slash?.onKeyDown(e)) return;
    handleKeydown(this.content, e, {
      notify: () => this.afterMutation(),
      undo: () => this.undo(),
      redo: () => this.redo(),
    }, this.registry.keymap, this.ctx);
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target && target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
      if (this.opts.readOnly) { e.preventDefault(); return; }
      const box = target as HTMLInputElement;
      queueMicrotask(() => {
        if (box.checked) box.setAttribute("checked", "");
        else box.removeAttribute("checked");
        box.closest("li")?.setAttribute("data-task", box.checked ? "done" : "todo");
        this.afterMutation();
      });
      return;
    }
    // Clicking a link opens the edit popover instead of navigating (Notion/
    // Medium behavior). Read-only editors keep native navigation.
    const link = target?.closest?.("a");
    if (link && this.content.contains(link) && !this.opts.readOnly) {
      e.preventDefault();
      openLinkEditor(this.ctx, link as HTMLElement);
      return;
    }
    // Clicking the empty space below the last block appends a paragraph
    // (Notion/Medium behavior) — the content's bottom padding is clickable.
    if (target === this.content && !this.opts.readOnly) {
      const last = this.content.lastElementChild as HTMLElement | null;
      if (last && e.clientY > last.getBoundingClientRect().bottom) {
        if (last.tagName === "P" && visibleText(last).trim() === "") {
          placeCaretAtStart(last);
          return;
        }
        const p = createElement("p", {}, "<br>");
        this.content.appendChild(p);
        placeCaretAtStart(p);
        this.afterMutation();
      }
    }
  }

  private openBlockMenu(block: HTMLElement, anchor: HTMLElement): void {
    if (this.opts.readOnly) return;
    // Menu items act on the CARET block — put the caret where the user is
    // pointing before anything runs (the hovered block is not necessarily the
    // caret block).
    placeCaretAtStart(block);
    const items = this.registry.blockMenuItems
      .filter((item) => !item.when || guard("block-menu", `when "${item.id}"`, () => item.when!(this.ctx, block)))
      .map((item) => ({
        id: item.id,
        title: item.title,
        group: item.group ?? "Actions",
        danger: item.danger,
        action: () => {
          placeCaretAtStart(block);
          this.transact(() =>
            guard("block-menu", `item "${item.id}"`, () => item.run(this.ctx, block)),
          );
          this.focus();
        },
      }));
    this.ui.menu({ anchor, items });
  }

  private insertParagraphAfter(block: HTMLElement): void {
    if (this.opts.readOnly) return;
    const p = createElement("p", {}, "<br>");
    block.after(p);
    placeCaretAtStart(p);
    this.content.focus();
    this.afterMutation();
  }

  private afterMutation(): void {
    if (this.transactionDepth > 0) return; // the outermost transact commits
    this.normalize();
    this.updatePlaceholder();
    this.recordHistory();
    this.scheduleChange();
    this.handleSelectionChange();
  }

  /** Re-establish the document schema; re-place the caret if it was reset. */
  private normalize(): void {
    const wasReset = normalizeDocument(this.content);
    if (wasReset) {
      const p = this.content.firstElementChild as HTMLElement | null;
      if (p && (document.activeElement === this.content || selectionInside(this.content))) {
        placeCaretAtStart(p);
      }
    }
  }

  private updatePlaceholder(): void {
    this.content.classList.toggle("ew-content--empty", this.isEmpty());
  }

  private scheduleChange(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.recordHistory();
      const md = this.getMarkdown();
      this.listeners.change.forEach((fn) => fn(md));
    }, 120);
  }

  // ── History (undo/redo) ────────────────────────────────────────────────────

  private seedHistory(): void {
    this.history = [{ md: this.getMarkdown(), caret: 0 }];
    this.historyIndex = 0;
  }

  private recordHistory(): void {
    if (this.restoring) return;
    const md = this.getMarkdown();
    if (this.history[this.historyIndex]?.md === md) return;
    // truncate any redo tail, then push
    this.history.length = this.historyIndex + 1;
    this.history.push({ md, caret: getCaretOffset(this.content) ?? 0 });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  private flushPendingHistory(): void {
    if (this.changeTimer) { clearTimeout(this.changeTimer); this.changeTimer = null; }
    this.recordHistory();
  }

  private restore(snap: Snapshot): void {
    this.restoring = true;
    this.setMarkdown(snap.md, { silent: true });
    try { setCaretOffset(this.content, snap.caret); } catch { /* caret best-effort */ }
    this.restoring = false;
    const md = snap.md;
    this.listeners.change.forEach((fn) => fn(md));
    this.handleSelectionChange();
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  private handleSelectionChange(): void {
    if (this.destroyed) return;
    const info = this.buildSelectionInfo();
    if (this.opts.toolbar && !this.opts.readOnly) this.toolbar?.update(info);
    this.updateBlockPlaceholder(info);
    this.listeners.selection.forEach((fn) => fn(info));
  }

  /** Notion-style hint on the FOCUSED empty paragraph (the document-level
   *  placeholder only covers the empty-document case). */
  private updateBlockPlaceholder(info: SelectionInfo | null): void {
    const prev = this.content.querySelector(".ew-block-empty");
    let target: HTMLElement | null = null;
    if (info && info.collapsed && !this.opts.readOnly && !this.isEmpty()) {
      const block = currentBlock(this.content);
      if (block && block.tagName === "P" && visibleText(block).trim() === "") {
        target = block;
      }
    }
    if (prev && prev !== target) prev.classList.remove("ew-block-empty");
    if (target) target.classList.add("ew-block-empty");
  }

  private buildSelectionInfo(): SelectionInfo | null {
    if (!selectionInside(this.content)) return null;
    const sel = getSelection();
    if (!sel) return null;
    const collapsed = sel.isCollapsed;
    const selected = sel.toString().trim();
    const marks: Record<string, boolean> = {};
    for (const [name, entry] of this.registry.commands) {
      if (!entry.spec.isActive) continue;
      marks[name] = !!guard(entry.plugin, `isActive "${name}"`, () => entry.spec.isActive!(this.ctx));
    }
    return {
      empty: collapsed || selected === "",
      collapsed,
      bold: !!marks.bold,
      italic: !!marks.italic,
      strike: !!marks.strike,
      code: !!marks.code,
      link: !!marks.link,
      marks,
      block: blockKindOf(currentBlock(this.content)),
      rect: collapsed ? null : selectionRect(),
    };
  }

  private emit(event: "focus" | "blur"): void {
    this.listeners[event].forEach((fn) => (fn as () => void)());
  }
}

export type { Command, EditorOptions };
